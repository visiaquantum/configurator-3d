import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Group, Object3D } from 'three'
import { Box3, Euler, MathUtils, Plane, Vector3 } from 'three'
import { TransformControls, useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type {
  Anchor,
  CatalogItem,
  Euler as EulerTuple,
  PlacedItem,
  Vec3,
} from '../types'
import { useConfiguratorStore } from '../state/store'
import { buildLocalCorners, registerItem, unregisterItem } from './itemRegistry'
import {
  findNearestVertexSnap,
  offsetForLockedCorners,
  pushOutOverlaps,
  VERTEX_SNAP_RELEASE_RADIUS,
} from './snapping'

interface Props {
  item: PlacedItem
  catalog: CatalogItem | undefined
  anchors?: Anchor[]
}

const ANCHOR_SNAP_RADIUS = 0.04 // 4 cm — distance to an enclosure anchor that triggers a snap
const DRAG_THRESHOLD_PX = 4 // mouse movement (px) before a pointerdown is treated as a drag
const ROTATION_SENSITIVITY = 0.01 // radians of Y rotation per pixel of horizontal mouse delta

// Scratch instances reused across pointermove. Drag is single-threaded so this
// is safe and saves ~100s of Vector3 allocations per second during a drag.
const _hit = new Vector3()
const _basePt = new Vector3()
const _euler = new Euler()

interface SnapLock {
  myCornerIdx: number
  otherCornerIdx: number
  otherId: string
}

interface DragCtx {
  mode: 'translate' | 'rotate'
  startClientX: number
  startClientY: number
  startRotX: number
  startRotY: number
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
  snapLock: SnapLock | null
}

function nearestAnchor(
  pos: Vector3,
  anchors: Anchor[],
): { anchor: Anchor; dist: number } | null {
  let best: { anchor: Anchor; dist: number } | null = null
  for (const a of anchors) {
    const dx = pos.x - a.position[0]
    const dy = pos.y - a.position[1]
    const dz = pos.z - a.position[2]
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (!best || d < best.dist) best = { anchor: a, dist: d }
  }
  return best
}

export function Item({ item, catalog, anchors = [] }: Props) {
  const url = catalog?.glbUrl
  if (!url) return null
  return <ItemInner item={item} catalog={catalog} anchors={anchors} url={url} />
}

function ItemInner({
  item,
  catalog,
  anchors = [],
  url,
}: Props & { url: string }) {
  const select = useConfiguratorStore((s) => s.select)
  const updateItem = useConfiguratorStore((s) => s.updateItem)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const gizmoMode = useConfiguratorStore((s) => s.gizmoMode)
  const setDraggingItemId = useConfiguratorStore((s) => s.setDraggingItemId)
  const readOnly = useConfiguratorStore((s) => s.readOnly)
  const isSelected = selectedId === item.id
  const isOverlapping = useConfiguratorStore((s) => s.overlappingIds.has(item.id))

  const [group, setGroup] = useState<Group | null>(null)
  const dragRef = useRef<DragCtx | null>(null)

  const gltf = useGLTF(url)
  const scale = catalog?.scale ?? 1
  const cloned = useMemo(() => {
    const c = gltf.scene.clone()
    c.scale.setScalar(scale)
    c.updateMatrixWorld(true)
    return c
  }, [gltf.scene, scale])

  const bbox = useMemo(() => {
    const b = new Box3().setFromObject(cloned)
    const size = new Vector3()
    const center = new Vector3()
    b.getSize(size)
    b.getCenter(center)
    return { size, center }
  }, [cloned])

  const catSize = catalog?.size
  const colliderSize = useMemo<Vec3>(
    () =>
      catSize
        ? [catSize[0] * scale, catSize[1] * scale, catSize[2] * scale]
        : [
            Math.max(bbox.size.x, 0.005),
            Math.max(bbox.size.y, 0.005),
            Math.max(bbox.size.z, 0.005),
          ],
    [catSize, scale, bbox.size.x, bbox.size.y, bbox.size.z],
  )

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
  useLayoutEffect(() => {
    if (!group) return
    const [px, py, pz] = snappedAnchor?.position ?? item.position
    group.position.set(px, py + colliderSize[1] / 2, pz)
    group.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2])
  }, [group, snappedAnchor, item.position, item.rotation, colliderSize])

  // Register with the cross-item registry for vertex-snap and overlap push-out.
  useLayoutEffect(() => {
    if (!group) return
    group.userData.exportable = true
    const localCorners = buildLocalCorners(colliderSize)
    registerItem({ id: item.id, group, localCorners })
    return () => unregisterItem(item.id)
  }, [item.id, colliderSize, group])
  /* eslint-enable react-hooks/immutability */

  const handleTransformEnd = () => {
    if (!group) return
    pushOutOverlaps(item.id)
    const newPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    _euler.setFromQuaternion(group.quaternion)
    const newRot: EulerTuple = [_euler.x, _euler.y, _euler.z]
    _basePt.set(newPos[0], newPos[1], newPos[2])
    const nearest = nearestAnchor(_basePt, anchors)
    if (nearest && nearest.dist <= ANCHOR_SNAP_RADIUS) {
      updateItem(item.id, {
        position: nearest.anchor.position,
        rotation: newRot,
        constraints: [{ type: 'snapToAnchor', target: nearest.anchor.id }],
      })
    } else {
      updateItem(item.id, { position: newPos, rotation: newRot, constraints: [] })
    }
  }

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (useConfiguratorStore.getState().walkMode) return
    e.stopPropagation()
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
      plane,
      grabOffset,
      started: false,
      snapLock: null,
    }
  }

  // Mutating the Group's transform is how Three.js drives the scene graph;
  // the lint rule is correct that we're modifying a useState value, but in
  // this case the value IS a mutable scene-graph node by design.
  /* eslint-disable react-hooks/immutability */
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
    if (d.mode === 'rotate') {
      group.rotation.y = d.startRotY + dx * ROTATION_SENSITIVITY
      group.rotation.x = d.startRotX + dy * ROTATION_SENSITIVITY
      return
    }
    if (!e.ray.intersectPlane(d.plane, _hit)) return
    group.position.x = _hit.x + d.grabOffset.x
    group.position.z = _hit.z + d.grabOffset.z
    // Y stays at the plane constant.

    // Grid snap (base step). Vertex snap below may override on engagement.
    const store = useConfiguratorStore.getState()
    if (store.snapToGridEnabled && store.gridStep > 0) {
      const s = store.gridStep
      group.position.x = Math.round(group.position.x / s) * s
      group.position.z = Math.round(group.position.z / s) * s
    }

    // Vertex snap with hysteresis. A held lock survives until the corner pair
    // drifts beyond RELEASE_RADIUS, then we look for a fresh pair within
    // ENGAGE_RADIUS. ENGAGE < RELEASE, so we don't oscillate at the threshold.
    if (d.snapLock) {
      const r = offsetForLockedCorners(
        item.id,
        d.snapLock.myCornerIdx,
        d.snapLock.otherId,
        d.snapLock.otherCornerIdx,
      )
      if (r && r.dist <= VERTEX_SNAP_RELEASE_RADIUS) {
        group.position.x += r.offset.x
        group.position.z += r.offset.z
      } else {
        d.snapLock = null
      }
    }
    if (!d.snapLock) {
      const snap = findNearestVertexSnap(item.id)
      if (snap) {
        group.position.x += snap.offset.x
        group.position.z += snap.offset.z
        d.snapLock = {
          myCornerIdx: snap.myCornerIdx,
          otherCornerIdx: snap.otherCornerIdx,
          otherId: snap.otherId,
        }
      }
    }

    // Live clearance from enclosure walls (item AABB ↔ enclosure AABB).
    const bbox = store.enclosureBBox
    if (bbox) {
      const hx = colliderSize[0] / 2
      const hy = colliderSize[1] / 2
      const hz = colliderSize[2] / 2
      const px = group.position.x
      const py = group.position.y
      const pz = group.position.z
      store.setDragClearance({
        itemId: item.id,
        left: px - hx - bbox.min[0],
        right: bbox.max[0] - (px + hx),
        back: pz - hz - bbox.min[2],
        front: bbox.max[2] - (pz + hz),
        bottom: py - hy - bbox.min[1],
        top: bbox.max[1] - (py + hy),
      })
    }
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as Element & { releasePointerCapture?: (id: number) => void })
      .releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    if (!d.started) return // pure click — selection already handled in pointerdown
    setDraggingItemId(null)
    useConfiguratorStore.getState().setDragClearance(null)
    if (!group) return

    if (d.mode === 'rotate') {
      updateItem(item.id, {
        rotation: [group.rotation.x, group.rotation.y, item.rotation[2]],
      })
      return
    }
    // Translate commit: resolve any residual AABB overlap (push along smaller
    // of X/Z), then check for enclosure-anchor snap. The live vertex-snap has
    // already aligned to a neighbour's corner if one was close enough.
    pushOutOverlaps(item.id)
    const newPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    _basePt.set(newPos[0], newPos[1], newPos[2])
    const nearest = nearestAnchor(_basePt, anchors)
    if (nearest && nearest.dist <= ANCHOR_SNAP_RADIUS) {
      updateItem(item.id, {
        position: nearest.anchor.position,
        constraints: [{ type: 'snapToAnchor', target: nearest.anchor.id }],
      })
    } else {
      updateItem(item.id, { position: newPos, constraints: [] })
    }
  }
  const handlePointerCancel = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as Element & { releasePointerCapture?: (id: number) => void })
      .releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDraggingItemId(null)
    useConfiguratorStore.getState().setDragClearance(null)
  }
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      <group
        ref={setGroup}
        onPointerDown={handlePointerDown}
        // eslint-disable-next-line react-hooks/immutability -- handler mutates group.position imperatively (three.js scene-graph)
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <group position={[-bbox.center.x, -colliderSize[1] / 2, -bbox.center.z]}>
          <primitive object={cloned} />
        </group>
        {isSelected && !readOnly && (
          <mesh>
            <boxGeometry
              args={[colliderSize[0] * 1.05, colliderSize[1] * 1.05, colliderSize[2] * 1.05]}
            />
            <meshBasicMaterial
              wireframe
              color={isOverlapping ? '#ff4040' : snappedAnchor ? '#33ff88' : '#ffcc33'}
            />
          </mesh>
        )}
        {!isSelected && isOverlapping && (
          <mesh>
            <boxGeometry
              args={[colliderSize[0] * 1.05, colliderSize[1] * 1.05, colliderSize[2] * 1.05]}
            />
            <meshBasicMaterial wireframe color="#ff4040" />
          </mesh>
        )}
      </group>

      {isSelected && group && !readOnly && (
        <TransformControls
          object={group as Object3D}
          mode={gizmoMode}
          size={MathUtils.clamp(Math.max(...colliderSize) * 4, 0.05, 0.3)}
          onMouseUp={handleTransformEnd}
        />
      )}
    </>
  )
}
