import { useSceneTools } from './useSceneTools'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Group, InstancedMesh, Material, Object3D } from 'three'
import {
  Color,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Matrix4,
  Plane,
  Vector3,
} from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { TransformControls } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { attachmentPoints, attachmentTargetIds, beginAttachment, chooseAttachmentPoint, chooseAttachmentTarget } from './attachment'
import type {
  Anchor,
  Euler as EulerTuple,
  PlacedItem,
  Vec3,
} from '../types'
import type { ItemSnapPoint } from '../types'
import { useConfiguratorStore, useConfiguratorStoreApi } from '../state/store'
import { buildLocalCorners } from './itemRegistry'
import { uprightYaw } from './rotation'
import {
  MIRROR_PAIR_RULE,
  mirrorAxisOf,
  mirrorPairConstraint,
  withSnapConstraint,
} from './mirrorPair'
import { VERTEX_SNAP_RELEASE_RADIUS } from './snapping'
import {
  assemblyGroup,
  assemblyPosePatches,
  itemSnapConstraint,
  linkedPartners,
  mirrorSnapPoints,
} from './mating'
import { rotateVector } from './geometry'
import { commitConnectionPreview, resolveConnectionPreview } from './connectionPreview'
import type { ConnectionPreview } from './connectionPreview'
import type { PreparedProductAsset } from './productAsset'
import { applyLiveItemPatches, assemblyCanMove, cornerOffsetsXZ, finishItemMovement, restoreLiveItems, rotateOffsetXZ } from './itemMovement'

interface Props {
  item: PlacedItem
  asset: PreparedProductAsset
  anchors?: Anchor[]
}

const DRAG_THRESHOLD_PX = 4 // mouse movement (px) before a pointerdown is treated as a drag
const ROTATION_SENSITIVITY = 0.01 // radians of Y rotation per pixel of horizontal mouse delta
const ROTATION_STEP = Math.PI / 2 // rotations snap to 90° increments
const SNAP_POINT_MARKER_RADIUS = 0.006

const snapAngle = (v: number) => Math.round(v / ROTATION_STEP) * ROTATION_STEP

// Tuning for item reflections. Picks up the scene Environment HDR so items
// look glossy and reflect the warehouse lighting like the enclosure paint.
const ITEM_ENV_INTENSITY = 1.5
const ITEM_CLEARCOAT = 0.5
const ITEM_CLEARCOAT_ROUGHNESS = 0.1

/**
 * Walk the cloned item scene and per-instance-clone each material so we can
 * boost reflections without leaking through the shared `useGLTF` cache.
 *
 * For MeshPhysicalMaterial we can also raise the clearcoat to add a glossy
 * top-coat. For plain MeshStandardMaterial we only boost envMapIntensity —
 * upgrading to Physical via `copy()` corrupts physical-specific uniforms
 * (transmission/thickness become undefined) and the mesh renders invisible.
 */
function enhanceItemMaterials(root: Object3D) {
  const materials = new Map<Material, Material>()
  const cloneMaterial = (m: Material): Material => {
    if (m instanceof MeshPhysicalMaterial) {
      const next = m.clone()
      next.envMapIntensity = Math.max(next.envMapIntensity, ITEM_ENV_INTENSITY)
      next.clearcoat = Math.max(next.clearcoat, ITEM_CLEARCOAT)
      next.clearcoatRoughness = Math.min(next.clearcoatRoughness, ITEM_CLEARCOAT_ROUGHNESS)
      next.needsUpdate = true
      return next
    }
    if (m instanceof MeshStandardMaterial) {
      const next = m.clone()
      next.envMapIntensity = Math.max(next.envMapIntensity, ITEM_ENV_INTENSITY)
      next.needsUpdate = true
      return next
    }
    return m.clone()
  }
  const upgrade = (m: Material) => {
    let cloned = materials.get(m)
    if (!cloned) { cloned = cloneMaterial(m); materials.set(m, cloned) }
    return cloned
  }
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(upgrade)
    } else {
      obj.material = upgrade(obj.material)
    }
  })
}

// Scratch instances reused across pointermove. Drag is single-threaded so this
// is safe and saves ~100s of Vector3 allocations per second during a drag.
const _hit = new Vector3()

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
  snapLock: SnapLock | null
  /** The rest of the assembly, with the group positions it started from. */
  followers: Array<{ id: string; start: Vector3 }>
}

export function Item({ item, asset, anchors = [] }: Props) {
  const storeApi = useConfiguratorStoreApi()
  const { getItem, registerItem, unregisterItem, clampItemToBounds, findNearestVertexSnap, offsetForLockedCorners, pushOutOverlaps } = useSceneTools()
  const select = useConfiguratorStore((s) => s.select)
  const updateItems = useConfiguratorStore((s) => s.updateItems)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const attachment = useConfiguratorStore((s) => s.attachment)
  const gizmoMode = useConfiguratorStore((s) => s.gizmoMode)
  const setDraggingItemId = useConfiguratorStore((s) => s.setDraggingItemId)
  const project = useConfiguratorStore((state) => state.project)
  const storeReadOnly = useConfiguratorStore((state) => state.readOnly)
  const walkMode = useConfiguratorStore((state) => state.walkMode)
  const readOnly = useMemo(() => !assemblyCanMove({ project, readOnly: storeReadOnly, walkMode }, item.id),
    [project, storeReadOnly, walkMode, item.id])
  const collisionBounds = useConfiguratorStore((s) => s.interiorBBox ?? s.enclosureBBox)
  const isSelected = selectedId === item.id
  const isOverlapping = useConfiguratorStore((s) => s.overlappingIds.has(item.id))
  const isAttachmentTarget = attachment?.hoveredItemId === item.id || attachment?.targetItemId === item.id

  const [group, setGroup] = useState<Group | null>(null)
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreview | null>(null)
  // Pointer-up may arrive before React has rendered the pointer-move state.
  // Keep the authoritative current ghost in a ref so a valid release cannot
  // accidentally fall back to a normal drag commit.
  const connectionPreviewRef = useRef<ConnectionPreview | null>(null)
  const updateConnectionPreview = (next: ConnectionPreview | null) => {
    connectionPreviewRef.current = next
    setConnectionPreview(next)
  }
  const dragRef = useRef<DragCtx | null>(null)
  const transformLockPosRef = useRef<Vector3 | null>(null)

  const colliderSize = asset.metadata.size
  const mirrored = item.mirrored === true
  const cloned = useMemo(() => {
    const c = cloneSkeleton(asset.scene)
    enhanceItemMaterials(c)
    if (mirrored) {
      // The mirror flip (scale.x = -1 on the wrapper) inverts face winding;
      // render both sides so the geometry doesn't show inside-out.
      c.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of mats) {
          // enhanceItemMaterials already cloned Standard/Physical materials,
          // so mutating them cannot leak into the shared useGLTF cache.
          if (m instanceof MeshStandardMaterial) m.side = DoubleSide
        }
      })
    }
    c.updateMatrixWorld(true)
    return c
  }, [asset.scene, mirrored])

  useEffect(() => () => {
    cloned.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) material.dispose()
    })
  }, [cloned])

  // Mirror flip for the twin of a mirror pair: along the local axis
  // perpendicular to the rule's mirror plane (X or Z depending on the GLB).
  const catalogRules = useConfiguratorStore((state) => state.itemRules[item.catalogId])
  const mirrorScale = useMemo<Vec3 | undefined>(() => {
    if (!mirrored) return undefined
    const rule = catalogRules?.find((r) => r.rule === MIRROR_PAIR_RULE)
    return rule && mirrorAxisOf(rule) === 'z' ? [1, 1, -1] : [-1, 1, 1]
  }, [mirrored, catalogRules])

  // Tint the item red when it overlaps another item or clips the enclosure
  // body. Originals captured once per material; we lerp toward red instead of
  // overwriting so textures/branding stay readable.
  const originalColorsRef = useRef<Map<MeshStandardMaterial, Color>>(new Map())
  useLayoutEffect(() => {
    if (!cloned) return
    const originals = originalColorsRef.current
    const RED = new Color(0xff0000)
    cloned.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (!(m instanceof MeshStandardMaterial)) continue
        if (!originals.has(m)) { originals.set(m, m.color.clone()); m.userData.originalColor = m.color.getHex() }
        const orig = originals.get(m)!
        if (isAttachmentTarget) {
          m.color.copy(orig).lerp(new Color('#22c9ed'), 0.45)
        } else if (isOverlapping) {
          m.color.copy(orig).lerp(RED, 0.6)
        } else {
          m.color.copy(orig)
        }
      }
    })
  }, [cloned, isOverlapping, isAttachmentTarget])

  /**
   * Items this one may legitimately overlap: whatever it is joined to through
   * a `snapToItem` constraint. Interlocking parts share material by design, so
   * the push-out must leave those pairs alone or it would prise the assembly
   * apart on every move.
   */
  const linkedTo = (id: string): ReadonlySet<string> | undefined => {
    const s = storeApi.getState()
    return s.project ? linkedPartners(id, s.project.items, s.project.connections ?? []) : undefined
  }

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
  const catalogSnaps = useConfiguratorStore((state) => state.itemSnaps[item.catalogId]) ?? asset.metadata.snaps
  const effectiveCatalogSnaps = useMemo(() => mirrorSnapPoints(catalogSnaps, mirrorScale), [catalogSnaps, mirrorScale])
  useLayoutEffect(() => {
    if (!group) return
    let px: number, py: number, pz: number
    if (snappedAnchor) {
      const sp = snapPointId ? effectiveCatalogSnaps.find((p) => p.id === snapPointId) : undefined
      const corner = snapCorner != null ? cornerOffsetsXZ(colliderSize)[snapCorner] : undefined
      if (sp) {
        // Snapped by a product snap point: place it exactly on the anchor.
        const [dx, dy, dz] = rotateVector(sp.position, item.rotation)
        px = snappedAnchor.position[0] - dx
        py = snappedAnchor.position[1] - (dy + colliderSize[1] / 2)
        pz = snappedAnchor.position[2] - dz
      } else if (corner) {
        // Snapped by a corner: place the item so that corner sits on the anchor.
        const [dx, dz] = rotateOffsetXZ(corner[0], corner[1], item.rotation[1])
        px = snappedAnchor.position[0] - dx
        py = snappedAnchor.position[1]
        pz = snappedAnchor.position[2] - dz
      } else {
        ;[px, py, pz] = snappedAnchor.position
      }
    } else {
      ;[px, py, pz] = item.position
    }
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
    if (itemSnapConstraint(item) || mirrorPairConstraint(item)) return
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
    updateItems([
      {
        id: item.id,
        patch: { position: nextPos, constraints: withSnapConstraint(item, null) },
      },
    ])
  }, [group, collisionBounds, item, item.id, item.position, colliderSize, updateItems, clampItemToBounds, readOnly])
  /* eslint-enable react-hooks/immutability */

  const handleTransformEnd = () => {
    if (!group) return
    const mode = storeApi.getState().gizmoMode
    const rotation: EulerTuple = [snapAngle(group.rotation.x), snapAngle(group.rotation.y), snapAngle(group.rotation.z)]
    if (mode === 'rotate' && transformLockPosRef.current) group.position.copy(transformLockPosRef.current)
    transformLockPosRef.current = null
    if (mode === 'translate' && commitCurrentConnectionPreview()) return
    finishItemMovement(storeApi, item.id, mode, rotation, anchors, effectiveCatalogSnaps)
    updateConnectionPreview(null)
  }

  /**
   * The rest of this item's assembly, with the live positions it starts from.
   * A translate moves them all by the same step: re-deriving each pose from its
   * seat would reach the same place more slowly, and only rigid motion is sure
   * to leave every joint exactly as tight as it was.
   */
  const assemblyFollowers = (): Array<{ id: string; start: Vector3 }> => {
    const s = storeApi.getState()
    const members = assemblyGroup(item.id, s.project?.items ?? [], s.project?.connections ?? [])
    const out: Array<{ id: string; start: Vector3 }> = []
    for (const id of members) {
      if (id === item.id) continue
      const reg = getItem(id)
      if (reg) out.push({ id, start: reg.group.position.clone() })
    }
    return out
  }

  /**
   * Live feedback mid-gesture: the rest of the frame put where this item's
   * current pose — turned as well as moved — has taken it. `true` when there
   * was a frame to move, which also means the single-part guards do not apply:
   * pushing this one member out or clamping it to the van would slide it off
   * the joints the others hold it by.
   *
   * Without this a turn showed the grabbed part swinging alone while the rest
   * stood still, and only the release put the frame back together.
   */
  const followLive = (): boolean => {
    if (!group) return false
    const s = storeApi.getState()
    const members = assemblyGroup(item.id, s.project?.items ?? [], s.project?.connections ?? [])
    if (members.size < 2) return false
    // A frame turns about the upright axis only. Tipping it would lift half its
    // members off the floor, and the commit keeps each one's own pitch anyway —
    // so a pitch shown here would be a pitch taken back on release.
    const yaw = uprightYaw(group.quaternion, item.rotation[1])
    group.rotation.set(item.rotation[0], yaw, item.rotation[2])
    groupFollowPatches(
      [group.position.x, group.position.y - colliderSize[1] / 2, group.position.z],
      group.rotation.y,
    )
    return true
  }

  const groupFollowPatches = (position: Vec3, yaw: number) => {
    const state = storeApi.getState()
    const items = state.project?.items ?? []
    const members = assemblyGroup(item.id, items, state.project?.connections ?? [])
    const patches = assemblyPosePatches(items, members, item, {
      position, rotation: [item.rotation[0], yaw, item.rotation[2]],
    }).filter((entry) => entry.id !== item.id)
    applyLiveItemPatches(state.itemRegistry, patches)
    return patches
  }

  /**
   * Magnet: a seat in range wins over the pointer. The part sits in it, turned
   * the way the joint needs, so the join is something you see during the
   * gesture instead of a jump on release. Out of range it goes back to
   * `restRotation` — the turn the last seat asked for is not the user's.
   *
   * `false` means the part is on its own: the single-part guards apply.
   */
  const holdInPreview = (preview: ConnectionPreview | null, restRotation: EulerTuple): boolean => {
    if (!group) return false
    if (!preview?.valid) {
      group.rotation.set(restRotation[0], restRotation[1], restRotation[2])
      return false
    }
    group.position.set(
      preview.position[0],
      preview.position[1] + colliderSize[1] / 2,
      preview.position[2],
    )
    group.rotation.set(preview.rotation[0], preview.rotation[1], preview.rotation[2])
    return true
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
    if (item.constraints?.some((constraint) => constraint.type === 'lockAxis')) return
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
      followers: assemblyFollowers(),
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
      updateConnectionPreview(null)
      group.position.copy(d.startPos)
      group.rotation.y = snapAngle(d.startRotY + dx * ROTATION_SENSITIVITY)
      group.rotation.x = snapAngle(d.startRotX + dy * ROTATION_SENSITIVITY)
      if (followLive()) return
      pushOutOverlaps(item.id, 8, linkedTo(item.id))
      clampItemToBounds(item.id, collisionBounds)
      return
    }
    if (!e.ray.intersectPlane(d.plane, _hit)) return
    group.position.x = _hit.x + d.grabOffset.x
    group.position.z = _hit.z + d.grabOffset.z
    // Y stays at the plane constant.

    // Grid snap (base step). Vertex snap below may override on engagement.
    const store = storeApi.getState()
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

    // Resolve the joint first: a part on its way into a valid seat must not be
    // shoved back out by the collision push-out, or it can never get close
    // enough for the snap to engage. A valid preview has already been through
    // `validateConfiguration`, bounds included, so it needs neither guard.
    const preview = currentConnectionPreview()
    updateConnectionPreview(preview)
    // The pose is worked out from the pointer at the top of every move, so the
    // magnet lets go on its own as soon as the pointer leaves its range.
    if (!holdInPreview(preview, [d.startRotX, d.startRotY, item.rotation[2]])) {
      // Hard collision constraints: separate from other products and keep the
      // collider inside the van/interior bounds. The rest of the assembly is
      // exempt: those parts share material with this one by design.
      pushOutOverlaps(item.id, 8, new Set(d.followers.map((f) => f.id)))
      clampItemToBounds(item.id, collisionBounds)
    }

    // Live: the whole assembly takes the same step — the mirrored half and
    // everything bolted on, however far down the chain.
    followLive()

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
    storeApi.getState().setDragClearance(null)
    if (!group) return

    if (d.mode === 'translate' && commitCurrentConnectionPreview()) return
    if (d.mode === 'rotate') group.position.copy(d.startPos)
    const rotation: EulerTuple = d.mode === 'rotate'
      ? [snapAngle(group.rotation.x), snapAngle(group.rotation.y), item.rotation[2]]
      : item.rotation
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
    setDraggingItemId(null)
    storeApi.getState().setDragClearance(null)
    updateConnectionPreview(null)
  }
  /* eslint-enable react-hooks/immutability */

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
        // eslint-disable-next-line react-hooks/immutability -- handler mutates group.position imperatively (three.js scene-graph)
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
        {attachment?.stage === 'source' && attachment.sourceItemId === item.id && <SnapPointMarkers points={attachmentPoints(storeApi.getState(), item.id)} interactive />}
        {attachment?.stage === 'point' && attachment.targetItemId === item.id && attachment.sourcePointId && <SnapPointMarkers points={attachmentPoints(storeApi.getState(), item.id, { itemId: attachment.sourceItemId, pointId: attachment.sourcePointId })} interactive />}
      </group>

      {isSelected && group && !readOnly && !attachment && (
        <TransformControls
          object={group as Object3D}
          mode={gizmoMode}
          size={MathUtils.clamp(Math.max(...colliderSize) * 4, 0.05, 0.3)}
          rotationSnap={ROTATION_STEP}
          showX={!item.constraints?.some((c) => c.type === 'lockAxis' && c.axis === 'x')}
          showY={gizmoMode === 'rotate' || !item.constraints?.some((c) => c.type === 'lockAxis' && c.axis === 'y')}
          showZ={!item.constraints?.some((c) => c.type === 'lockAxis' && c.axis === 'z')}
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
            if (gizmoMode === 'translate') {
              const preview = currentConnectionPreview()
              updateConnectionPreview(preview)
              if (holdInPreview(preview, item.rotation)) {
                followLive()
                return
              }
            }
            // The gizmo drags one object; the frame it belongs to comes along
            // every frame, or it only catches up on release.
            if (followLive()) return
            pushOutOverlaps(item.id, 8, linkedTo(item.id))
            clampItemToBounds(item.id, collisionBounds)
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
}

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

  useFrame(({ camera, size }) => {
    const mesh = ref.current
    if (!mesh || !interactive) return
    const world = mesh.getWorldPosition(new Vector3())
    const fov = 'fov' in camera ? camera.fov as number : 45
    const radius = Math.max(0.007, camera.position.distanceTo(world) * 2 * Math.tan(fov * Math.PI / 360) / Math.max(size.height, 1) * 6)
    const matrix = new Matrix4()
    points.forEach((point, index) => {
      matrix.makeScale(radius * (point.id === hovered ? 1.3 : 1), radius * (point.id === hovered ? 1.3 : 1), radius * (point.id === hovered ? 1.3 : 1))
      matrix.setPosition(...point.position)
      mesh.setMatrixAt(index, matrix)
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
