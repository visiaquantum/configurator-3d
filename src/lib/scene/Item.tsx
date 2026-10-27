import { useSceneTools } from './useSceneTools'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Group, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'
import { Color, MathUtils, Matrix4, OrthographicCamera, Plane, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { TransformControls } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { attachmentPoints, attachmentTargetIds, beginAttachment, chooseAttachmentPoint, chooseAttachmentTarget } from './attachment'
import type { Anchor, ItemSnapPoint, PlacedItem, Vec3 } from '../types'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { buildLocalCorners } from './itemRegistry'
import { mirrorPairConstraint } from './mirrorPair'
import { mirrorScaleFor, mirrorSnapPoints } from './mating'
import { followAssemblyLive, holdInSeat, placeDraggedItem, separateFreePart } from './liveDrag'
import type { VertexSnapLock } from './liveDrag'
import { assemblyMembers, hasJoints, jointsOf } from '../assembly/graph'
import { commitConnectionPreview, resolveConnectionPreview } from './connectionPreview'
import type { ConnectionPreview } from './connectionPreview'
import type { PreparedProductAsset } from './productAsset'
import { anchoredBasePosition, dragClearance, finishItemMovement, pointerTurn, restoreLiveItems, snappedRotation } from './itemMovement'
import { applyItemTint, disposeItemMaterials, enhanceItemMaterials, renderBothSides } from './itemMaterials'
import { selectCanMove, selectCollisionBounds } from '../state/selectors'
import { own } from '../util/record'

interface Props {
  item: PlacedItem
  asset: PreparedProductAsset
  anchors: Anchor[]
}

const DRAG_THRESHOLD_PX = 4 // mouse movement (px) before a pointerdown is treated as a drag
const ROTATION_STEP = Math.PI / 2 // rotations snap to 90° increments
const SNAP_POINT_MARKER_RADIUS = 0.006

// Scratch instances reused across pointermove. Drag is single-threaded so this
// is safe and saves ~100s of Vector3 allocations per second during a drag.
const _hit = new Vector3()
const _markerWorld = new Vector3()
const _markerMatrix = new Matrix4()
// Original material colours per item clone: a new clone (mirror toggle, new
// model) gets a new map, and a discarded one releases its materials with it.
const originalColorsByClone = new WeakMap<Object3D, Map<MeshStandardMaterial, Color>>()
const NONE: ReadonlySet<string> = new Set()

interface DragCtx {
  mode: 'translate' | 'rotate'
  startClientX: number
  startClientY: number
  startRotX: number
  startRotY: number
  /** Fixed group position used while rotating; rotation must not translate. */
  startPos: Vector3
  /** Horizontal plane at the group's initial Y; raycast target for translate. */
  plane: Plane
  /** group.position − pointer-hit at pointer-down. Preserves the grab offset. */
  grabOffset: Vector3
  /** True once the pointer has moved DRAG_THRESHOLD_PX from its origin. */
  started: boolean
  /**
   * Hold a snapped corner pair until the mouse-driven position drifts beyond
   * VERTEX_SNAP_RELEASE_RADIUS. Prevents the closest corner from flipping
   * between candidates each frame (visible as jitter).
   */
  snapLock: VertexSnapLock | null
  /** The rest of the assembly: exempt from the push-out, those parts share material by design. */
  followers: ReadonlySet<string>
}

const sameSeat = (a: ConnectionPreview | null, b: ConnectionPreview | null) => a === b || (!!a && !!b &&
  a.valid === b.valid && a.position.every((v, i) => v === b.position[i]) && a.rotation.every((v, i) => v === b.rotation[i]))

/** Memoised: a placed item re-renders for its own data and flags, not for its siblings'. */
export const Item = memo(function Item({ item, asset, anchors }: Props) {
  const storeApi = useConfiguratorStoreApi()
  const { registerItem, unregisterItem, clampItemToBounds } = useSceneTools()
  // The orbit must stop on the press itself: the store's `draggingItemId` only
  // disables it after the drag threshold and a re-render, and until then every
  // drag also turned the camera.
  const getThree = useThree((state) => state.get)
  const holdCamera = (held: boolean) => {
    const controls = getThree().controls as { enabled?: boolean } | null
    if (controls && 'enabled' in controls) controls.enabled = !held && !storeApi.getState().walkMode
  }
  const select = useConfiguratorStore((s) => s.select)
  // Each item subscribes to its own flags only: a selection or hover change
  // elsewhere must not re-render every placed product.
  const isSelected = useConfiguratorStore((s) => s.selectedId === item.id)
  const attachmentOpen = useConfiguratorStore((s) => !!s.attachment)
  const isAttachmentTarget = useConfiguratorStore((s) => s.attachment?.hoveredItemId === item.id || s.attachment?.targetItemId === item.id)
  const showsSourcePoints = useConfiguratorStore((s) => s.attachment?.stage === 'source' && s.attachment.sourceItemId === item.id)
  const targetPointsFor = useConfiguratorStore(useShallow((s) => s.attachment?.stage === 'point' && s.attachment.targetItemId === item.id && s.attachment.sourcePointId
    ? { itemId: s.attachment.sourceItemId, pointId: s.attachment.sourcePointId } : null))
  const gizmoMode = useConfiguratorStore((s) => s.gizmoMode)
  const setDraggingItemId = useConfiguratorStore((s) => s.setDraggingItemId)
  // One boolean per item: the frozen set is computed once per project snapshot.
  const readOnly = useConfiguratorStore((state) => !selectCanMove(state, item.id))
  const collisionBounds = useConfiguratorStore(selectCollisionBounds)
  const isOverlapping = useConfiguratorStore((s) => s.overlappingIds.has(item.id))

  const [group, setGroup] = useState<Group | null>(null)
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreview | null>(null)
  // Pointer-up may arrive before React has rendered the pointer-move state.
  // Keep the authoritative current ghost in a ref so a valid release cannot
  // accidentally fall back to a normal drag commit.
  const connectionPreviewRef = useRef<ConnectionPreview | null>(null)
  // The ghost is recomputed on every pointer move; re-render only when the
  // seat it shows actually changes.
  const updateConnectionPreview = (next: ConnectionPreview | null) => {
    const previous = connectionPreviewRef.current
    connectionPreviewRef.current = next
    if (!sameSeat(previous, next)) setConnectionPreview(next)
  }
  const dragRef = useRef<DragCtx | null>(null)
  const transformLockPosRef = useRef<Vector3 | null>(null)

  const colliderSize = asset.metadata.size
  const mirrored = item.mirrored === true
  const cloned = useMemo(() => {
    const c = cloneSkeleton(asset.scene)
    enhanceItemMaterials(c)
    if (mirrored) renderBothSides(c)
    c.updateMatrixWorld(true)
    return c
  }, [asset.scene, mirrored])

  useEffect(() => () => disposeItemMaterials(cloned), [cloned])

  // Mirror flip for the twin of a mirror pair: along the local axis
  // perpendicular to the rule's mirror plane (X or Z depending on the GLB).
  const catalogRules = useConfiguratorStore((state) => own(state.itemRules, item.catalogId))
  const mirrorScale = useMemo<Vec3 | undefined>(
    () => mirrorScaleFor({ mirrored, catalogId: item.catalogId }, catalogRules ? { [item.catalogId]: catalogRules } : {}) ?? undefined,
    [mirrored, item.catalogId, catalogRules],
  )

  // Tint the item when it is a candidate attachment target, or red when it
  // collides with another item or clips the enclosure.
  useLayoutEffect(() => {
    if (!originalColorsByClone.has(cloned)) originalColorsByClone.set(cloned, new Map())
    applyItemTint(cloned, originalColorsByClone.get(cloned)!, isAttachmentTarget ? 'attachment-target' : isOverlapping ? 'collision' : null)
  }, [cloned, isOverlapping, isAttachmentTarget])

  const currentConnectionPreview = () => resolveConnectionPreview(storeApi.getState(), item.id)

  const snapConstraint = item.constraints?.find((c) => c.type === 'snapToAnchor')
  const snappedAnchor = snapConstraint
    ? anchors.find((a) => a.id === snapConstraint.target)
    : undefined

  // Sync the group's transform with `item` whenever external state changes
  // (undo/redo, Inspector edits, snap-toggle). Drag handlers mutate
  // group.position imperatively; no JSX `position` prop fights them. Mutating
  // the Three.js Group held in state is the idiomatic scene-graph pattern;
  // React state holds the (stable) reference, not the world transform.
  /* eslint-disable react-hooks/immutability */
  const snapCorner = snapConstraint?.corner ?? null
  const snapPointId = snapConstraint?.point ?? null
  const catalogSnaps = useConfiguratorStore((state) => own(state.itemSnaps, item.catalogId)) ?? asset.metadata.snaps
  const effectiveCatalogSnaps = useMemo(() => mirrorSnapPoints(catalogSnaps, mirrorScale), [catalogSnaps, mirrorScale])
  useLayoutEffect(() => {
    if (!group) return
    const [px, py, pz] = snappedAnchor
      ? anchoredBasePosition(snappedAnchor, { point: snapPointId, corner: snapCorner }, item.rotation, effectiveCatalogSnaps, colliderSize)
      : item.position
    group.position.set(px, py + colliderSize[1] / 2, pz)
    group.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2])
    if (snappedAnchor) storeApi.getState().hydrateItemPosition(item.id, [px, py, pz])
  }, [
    group,
    snappedAnchor,
    snapCorner,
    snapPointId,
    effectiveCatalogSnaps,
    item.position,
    item.rotation,
    colliderSize,
    item.id,
    storeApi,
  ])

  // Register with the cross-item registry for vertex-snap and overlap push-out.
  useLayoutEffect(() => {
    if (!group) return
    group.userData.exportable = true
    const localCorners = buildLocalCorners(colliderSize)
    registerItem({ id: item.id, group, localCorners })
    return () => unregisterItem(item.id)
  }, [item.id, item.catalogId, colliderSize, group, registerItem, unregisterItem, storeApi])

  // If an item is loaded/added before enclosure bounds are ready, normalize it
  // as soon as bounds exist so it never starts below the floor or outside the van.
  useLayoutEffect(() => {
    if (!group || !collisionBounds || readOnly) return
    // A joined part is held by its joint, not by the van, and so is the twin of
    // a mirror pair: both are placed by something else. Clamping either slides
    // it off its seat, and the patch below then drops the joint as well — so an
    // assembly that reaches past the van could never be built, however it was
    // oriented afterwards. Validation still reports it, and moving the whole
    // assembly clears it.
    const state = storeApi.getState()
    if (!state.project || hasJoints(jointsOf(state.project), item.id) || mirrorPairConstraint(item)) return
    const moved = clampItemToBounds(item.id, collisionBounds)
    if (!moved) return
    const nextPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    if (
      Math.abs(nextPos[0] - item.position[0]) < 1e-6 &&
      Math.abs(nextPos[1] - item.position[1]) < 1e-6 &&
      Math.abs(nextPos[2] - item.position[2]) < 1e-6
    ) return
    storeApi.getState().settleItemPosition(item.id, nextPos)
  }, [group, collisionBounds, item, item.id, item.position, colliderSize, clampItemToBounds, readOnly, storeApi])
  /* eslint-enable react-hooks/immutability */

  const handleTransformEnd = () => {
    if (!group) return
    const mode = storeApi.getState().gizmoMode
    const rotation = snappedRotation(group.rotation)
    if (mode === 'rotate' && transformLockPosRef.current) group.position.copy(transformLockPosRef.current)
    transformLockPosRef.current = null
    if (mode === 'translate' && commitCurrentConnectionPreview()) return
    finishItemMovement(storeApi, item.id, mode, rotation, anchors, effectiveCatalogSnaps)
    updateConnectionPreview(null)
  }

  const followersOf = (): ReadonlySet<string> => {
    const s = storeApi.getState()
    const members = s.project ? assemblyMembers(s.project.items, jointsOf(s.project), item.id) : new Set<string>()
    members.delete(item.id)
    return members
  }

  const commitCurrentConnectionPreview = (): boolean => {
    const handled = commitConnectionPreview(storeApi, connectionPreviewRef.current)
    if (handled) updateConnectionPreview(null)
    return handled
  }

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    if (storeApi.getState().walkMode) return
    e.stopPropagation()
    if (storeApi.getState().attachment) return
    if (!isSelected) select(item.id)
    if (readOnly) return
    if (!group) return
    ;(e.target as Element & { setPointerCapture?: (id: number) => void })
      .setPointerCapture?.(e.pointerId)

    // Drag plane at the group's current Y so translate stays on the same height.
    const plane = new Plane(new Vector3(0, 1, 0), -group.position.y)
    const initialHit = new Vector3()
    e.ray.intersectPlane(plane, initialHit)
    const grabOffset = new Vector3().subVectors(group.position, initialHit)

    dragRef.current = {
      mode: e.shiftKey ? 'rotate' : 'translate',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRotX: group.rotation.x,
      startRotY: group.rotation.y,
      startPos: group.position.clone(),
      plane,
      grabOffset,
      started: false,
      snapLock: null,
      followers: followersOf(),
    }
    holdCamera(true)
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d || !group) return
    const dx = e.clientX - d.startClientX
    const dy = e.clientY - d.startClientY
    if (!d.started) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      d.started = true
      setDraggingItemId(item.id)
    }
    const state = storeApi.getState()
    if (d.mode === 'rotate') {
      updateConnectionPreview(null)
      group.position.copy(d.startPos)
      group.rotation.set(...pointerTurn([d.startRotX, d.startRotY, item.rotation[2]], dx))
      if (!followAssemblyLive(state, item.id)) separateFreePart(state, item.id, NONE)
      return
    }
    // Y stays at the drag plane.
    if (!e.ray.intersectPlane(d.plane, _hit)) return
    d.snapLock = placeDraggedItem(state, item.id, _hit.x + d.grabOffset.x, _hit.z + d.grabOffset.z, d.snapLock, d.followers)

    // Resolve the joint first: a part on its way into a valid seat must not be
    // shoved back out by the collision push-out, or it can never get close
    // enough for the snap to engage. A valid preview has already been through
    // `validateConfiguration`, bounds included, so it needs neither guard.
    // The pose comes from the pointer at every move, so the magnet lets go on
    // its own as soon as the pointer leaves its range.
    const preview = currentConnectionPreview()
    updateConnectionPreview(preview)
    if (!holdInSeat(state, item.id, preview, [d.startRotX, d.startRotY, item.rotation[2]])) separateFreePart(state, item.id, d.followers)
    // The whole assembly takes the same step, however far down the chain.
    followAssemblyLive(state, item.id)
    if (state.enclosureBBox) state.setDragClearance(dragClearance(item.id, group.position.toArray(), colliderSize, state.enclosureBBox))
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as Element & { releasePointerCapture?: (id: number) => void })
      .releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    holdCamera(false)
    if (!d.started) return // pure click — selection already handled in pointerdown
    setDraggingItemId(null)
    storeApi.getState().setDragClearance(null)
    if (!group) return

    if (d.mode === 'translate' && commitCurrentConnectionPreview()) return
    if (d.mode === 'rotate') group.position.copy(d.startPos)
    const rotation = d.mode === 'rotate' ? snappedRotation(group.rotation) : item.rotation
    finishItemMovement(storeApi, item.id, d.mode, rotation, anchors, effectiveCatalogSnaps)
    updateConnectionPreview(null)
  }

  const handlePointerCancel = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as Element & { releasePointerCapture?: (id: number) => void })
      .releasePointerCapture?.(e.pointerId)
    restoreLiveItems(storeApi.getState())
    dragRef.current = null
    holdCamera(false)
    setDraggingItemId(null)
    storeApi.getState().setDragClearance(null)
    updateConnectionPreview(null)
  }

  return (
    <>
      <group
        ref={setGroup}
        onContextMenu={(event) => {
          event.stopPropagation()
          event.nativeEvent.preventDefault()
          const rect = storeApi.getState().captureRefs?.gl.domElement.getBoundingClientRect()
          if (rect) beginAttachment(storeApi, item.id, [Math.max(12, Math.min(event.clientX - rect.left, rect.width - 252)), Math.max(12, Math.min(event.clientY - rect.top, rect.height - 230))])
        }}
        onClick={(event) => {
          const state = storeApi.getState()
          if (state.attachment?.stage === 'target' && attachmentTargetIds(state).has(item.id)) {
            event.stopPropagation()
            chooseAttachmentTarget(storeApi, item.id)
          }
        }}
        onPointerOver={(event) => {
          const state = storeApi.getState()
          if (state.attachment?.stage === 'target' && attachmentTargetIds(state).has(item.id)) {
            event.stopPropagation()
            state.setAttachment({ ...state.attachment, hoveredItemId: item.id })
          }
        }}
        onPointerOut={() => {
          const state = storeApi.getState()
          if (state.attachment?.hoveredItemId === item.id) state.setAttachment({ ...state.attachment, hoveredItemId: undefined })
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <group scale={mirrorScale}>
          <group
            position={asset.offset}
          >
            <primitive object={cloned} dispose={null} />
          </group>
        </group>
        {(isSelected || isAttachmentTarget) && !readOnly && (
          <mesh userData={{ configuratorHelper: true }}>
            <boxGeometry
              args={[colliderSize[0] * 1.05, colliderSize[1] * 1.05, colliderSize[2] * 1.05]}
            />
            <meshBasicMaterial
              wireframe
              color={isAttachmentTarget ? '#36d6ff' : isOverlapping ? '#ff4040' : snappedAnchor ? '#33ff88' : '#ffcc33'}
            />
          </mesh>
        )}
        {!isSelected && isOverlapping && (
          <mesh userData={{ configuratorHelper: true }}>
            <boxGeometry
              args={[colliderSize[0] * 1.05, colliderSize[1] * 1.05, colliderSize[2] * 1.05]}
            />
            <meshBasicMaterial wireframe color="#ff4040" />
          </mesh>
        )}
        {showsSourcePoints && <SnapPointMarkers points={attachmentPoints(storeApi.getState(), item.id)} interactive />}
        {targetPointsFor && <SnapPointMarkers points={attachmentPoints(storeApi.getState(), item.id, targetPointsFor)} interactive />}
      </group>

      {isSelected && group && !readOnly && !attachmentOpen && (
        <TransformControls
          object={group as Object3D}
          mode={gizmoMode}
          size={MathUtils.clamp(Math.max(...colliderSize) * 4, 0.05, 0.3)}
          rotationSnap={ROTATION_STEP}
          onMouseDown={() => {
            dragRef.current = null
            transformLockPosRef.current = gizmoMode === 'rotate' ? group.position.clone() : null
          }}
          onObjectChange={() => {
            if (gizmoMode === 'rotate' && transformLockPosRef.current) {
              group.position.copy(transformLockPosRef.current)
            }
            // Same magnet as the drag: the arrows carry the part to a seat in
            // range instead of stopping wherever the axis ran out. A turn is a
            // turn the user asked for, so the magnet stays out of that mode.
            const state = storeApi.getState()
            if (gizmoMode === 'translate') {
              // Exactly the pointer drag: a seat in range wins; otherwise the
              // part is kept clear of other products (its assembly excepted).
              const preview = currentConnectionPreview()
              updateConnectionPreview(preview)
              if (!holdInSeat(state, item.id, preview, item.rotation)) separateFreePart(state, item.id, followersOf())
              followAssemblyLive(state, item.id)
              return
            }
            // A turn: the assembly it belongs to comes along every frame, or
            // it only catches up on release.
            if (!followAssemblyLive(state, item.id)) separateFreePart(state, item.id, NONE)
          }}
          onMouseUp={handleTransformEnd}
        />
      )}
      {connectionPreview && (
        <mesh
          position={[
            connectionPreview.position[0],
            connectionPreview.position[1] + colliderSize[1] / 2,
            connectionPreview.position[2],
          ]}
          rotation={connectionPreview.rotation}
          renderOrder={1001}
        >
          <boxGeometry args={[colliderSize[0] * 1.04, colliderSize[1] * 1.04, colliderSize[2] * 1.04]} />
          <meshBasicMaterial
            wireframe
            transparent
            opacity={0.7}
            depthTest={false}
            color={connectionPreview.valid ? '#33ff88' : '#ff4040'}
          />
        </mesh>
      )}
    </>
  )
})

/**
 * Snap points of the selected item, drawn as one instanced mesh.
 *
 * A perforated shelf publishes ~750 points; one `<mesh>` each would mean that
 * many draw calls, geometries and materials. Instancing keeps it to one of
 * each. The instance count is baked into the buffer at construction, so the
 * `key` forces a fresh mesh whenever it changes.
 */
function SnapPointMarkers({ points, interactive = false }: { points: ItemSnapPoint[]; interactive?: boolean }) {
  const store = useConfiguratorStoreApi()
  const ref = useRef<InstancedMesh>(null)
  const hovered = useConfiguratorStore((state) => state.attachment?.hoveredPointId)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new Matrix4()
    points.forEach((p, i) => {
      m.makeTranslation(p.position[0], p.position[1], p.position[2])
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, new Color(p.id === hovered ? '#ffffff' : '#25cef4'))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [points, hovered])

  // Markers keep a constant on-screen size. Instance matrices are rewritten
  // only when that size or the hovered point changes, not on every frame.
  const written = useRef<{ radius: number; hovered: string | undefined; points: ItemSnapPoint[] } | null>(null)
  useFrame(({ camera, size }) => {
    const mesh = ref.current
    if (!mesh || !interactive) return
    const pixels = Math.max(size.height, 1)
    const worldPerPixel = camera instanceof OrthographicCamera
      ? (camera.top - camera.bottom) / camera.zoom / pixels
      : camera.position.distanceTo(mesh.getWorldPosition(_markerWorld)) * 2 * Math.tan(((camera as PerspectiveCamera).fov ?? 45) * Math.PI / 360) / pixels
    const radius = Math.max(0.007, worldPerPixel * 6)
    const last = written.current
    if (last && last.points === points && last.hovered === hovered && Math.abs(last.radius - radius) <= radius * 0.01) return
    written.current = { radius, hovered, points }
    points.forEach((point, index) => {
      const r = radius * (point.id === hovered ? 1.3 : 1)
      _markerMatrix.makeScale(r, r, r).setPosition(...point.position)
      mesh.setMatrixAt(index, _markerMatrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  if (points.length === 0) return null
  return (
    <instancedMesh
      key={points.length}
      ref={ref}
      userData={{ configuratorHelper: true }}
      args={[undefined, undefined, points.length]}
      renderOrder={1001}
      frustumCulled={false}
      onPointerDown={interactive ? (event) => event.stopPropagation() : undefined}
      onPointerOver={interactive ? (event) => {
        event.stopPropagation()
        const point = points[event.instanceId ?? -1]
        const state = store.getState()
        if (point && state.attachment) state.setAttachment({ ...state.attachment, hoveredPointId: point.id, error: undefined })
      } : undefined}
      onPointerMove={interactive ? (event) => {
        event.stopPropagation()
        const point = points[event.instanceId ?? -1]
        const state = store.getState()
        if (point && state.attachment && state.attachment.hoveredPointId !== point.id) state.setAttachment({ ...state.attachment, hoveredPointId: point.id, error: undefined })
      } : undefined}
      onPointerOut={interactive ? () => {
        const state = store.getState()
        if (state.attachment) state.setAttachment({ ...state.attachment, hoveredPointId: undefined })
      } : undefined}
      onClick={interactive ? (event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        const point = points[event.instanceId ?? -1]
        if (point) chooseAttachmentPoint(store, point.id)
      } : undefined}
    >
      <sphereGeometry args={[interactive ? 1 : SNAP_POINT_MARKER_RADIUS, 12, 8]} />
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.9}
        depthTest={false}
        toneMapped={false}
      />
    </instancedMesh>
  )
}
