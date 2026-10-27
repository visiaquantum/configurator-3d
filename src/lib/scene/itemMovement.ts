import type { ConfiguratorState, ConfiguratorStore } from '../state/store'
import type { Anchor, Connection, Euler, ItemConstraint, ItemSnapPoint, PlacedItem, Vec3 } from '../types'
import type { ItemRegistry } from './itemRegistry'
import { colliderSizeOf } from './itemRegistry'
import { assemblyGroup, assemblyPosePatches, jointsSurvivingMove, rotateGroupPatches } from './mating'
import { withSnapConstraint } from './mirrorPair'
import { clampItemToBounds, pushOutOverlaps } from './snapping'

const ANCHOR_SNAP_RADIUS = 0.06
const ANCHOR_SNAP_MAX_DY = 0.3
export type ItemPatch = { id: string; patch: Partial<PlacedItem> }

/** XZ offsets of the 4 bottom corners of a centered collider box. */
export function cornerOffsetsXZ(size: Vec3): Array<[number, number]> {
  const hx = size[0] / 2
  const hz = size[2] / 2
  return [
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
  ]
}

/** Rotate an XZ offset by `yaw` radians around +Y (three.js convention). */
export function rotateOffsetXZ(ox: number, oz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [ox * c + oz * s, -ox * s + oz * c]
}

interface AnchorSnapHit {
  anchor: Anchor
  /** Index into cornerOffsetsXZ, or null when the item center snapped. */
  corner: number | null
  /** Id of the product snap point that snapped, or null. Wins over corner. */
  point: string | null
  /** New item base position that puts the snapped point on the anchor. */
  position: Vec3
  dist: number
}

interface SnapCandidate {
  corner: number | null
  point: string | null
  dx: number
  dz: number
  /** Y offset of the candidate point above the item base. */
  oy: number
}

/**
 * Nearest anchor within ANCHOR_SNAP_RADIUS of the item center, any of its 4
 * bottom corners, or any product snap point declared in the GLB. Distance is
 * measured on XZ only (the anchor supplies the Y), with a vertical window so
 * floor drags don't grab wall anchors.
 */
function findAnchorSnap(
  base: Vec3,
  yaw: number,
  colliderSize: Vec3,
  anchors: Anchor[],
  snapPoints: ItemSnapPoint[],
): AnchorSnapHit | null {
  const candidates: SnapCandidate[] = [{ corner: null, point: null, dx: 0, dz: 0, oy: 0 }]
  cornerOffsetsXZ(colliderSize).forEach(([ox, oz], i) => {
    const [dx, dz] = rotateOffsetXZ(ox, oz, yaw)
    candidates.push({ corner: i, point: null, dx, dz, oy: 0 })
  })
  for (const sp of snapPoints) {
    const [dx, dz] = rotateOffsetXZ(sp.position[0], sp.position[2], yaw)
    candidates.push({
      corner: null,
      point: sp.id,
      dx,
      dz,
      oy: sp.position[1] + colliderSize[1] / 2,
    })
  }
  let best: AnchorSnapHit | null = null
  for (const a of anchors) {
    for (const cand of candidates) {
      if (Math.abs(base[1] + cand.oy - a.position[1]) > ANCHOR_SNAP_MAX_DY) continue
      const d = Math.hypot(
        base[0] + cand.dx - a.position[0],
        base[2] + cand.dz - a.position[2],
      )
      if (d <= ANCHOR_SNAP_RADIUS && (!best || d < best.dist)) {
        best = {
          anchor: a,
          corner: cand.corner,
          point: cand.point,
          dist: d,
          position: [
            a.position[0] - cand.dx,
            a.position[1] - cand.oy,
            a.position[2] - cand.dz,
          ],
        }
      }
    }
  }
  return best
}

/** snapToAnchor constraint recording which item feature landed on the anchor. */
function snapHitConstraint(hit: AnchorSnapHit): ItemConstraint {
  return {
    type: 'snapToAnchor',
    target: hit.anchor.id,
    ...(hit.point
      ? { point: hit.point }
      : hit.corner != null
        ? { corner: hit.corner }
        : {}),
  }
}

/** The same editability rule is used by scene gestures, guided attachment and the inspector. */
export function assemblyCanMove(state: Pick<ConfiguratorState, 'project' | 'readOnly' | 'walkMode'>, id: string): boolean {
  if (!state.project || state.readOnly || state.walkMode) return false
  const members = assemblyGroup(id, state.project.items, state.project.connections ?? [])
  return state.project.items.some((item) => item.id === id) && !state.project.items.some((item) =>
    members.has(item.id) && (item.locked || item.constraints?.some((constraint) => constraint.type === 'lockAxis')),
  )
}

/** Shared adapter from persisted base poses to live collider-centred Three.js transforms. */
export function applyLiveItemPatches(registry: ItemRegistry, patches: ItemPatch[]): void {
  for (const { id, patch } of patches) {
    const live = registry.get(id)
    if (!live) continue
    if (patch.position) live.group.position.set(
      patch.position[0], patch.position[1] + (colliderSizeOf(id, registry)?.[1] ?? 0) / 2, patch.position[2],
    )
    if (patch.rotation) live.group.rotation.set(...patch.rotation)
    live.group.updateWorldMatrix(true, false)
  }
}

export function restoreLiveItems(state: ConfiguratorState): void {
  applyLiveItemPatches(state.itemRegistry, (state.project?.items ?? []).map((item) => ({ id: item.id, patch: item })))
}

/** A rejected edit must also roll back its live preview. */
export function commitLiveItemPatches(store: ConfiguratorStore, patches: ItemPatch[], connections?: Connection[]): void {
  try {
    if (connections === undefined) store.getState().updateItems(patches)
    else store.getState().commitAssembly(patches, connections)
  } finally {
    restoreLiveItems(store.getState())
  }
}

/** Inspector rotations and gesture rotations share the same rigid assembly operation. */
export function rotateAssembly(store: ConfiguratorStore, id: string, step: number): void {
  const state = store.getState()
  const item = state.project?.items.find((entry) => entry.id === id)
  if (!item || !state.project || !assemblyCanMove(state, id)) return
  const members = assemblyGroup(id, state.project.items, state.project.connections ?? [])
  commitLiveItemPatches(store, rotateGroupPatches(state.project.items, members, item.position, step))
}

/** Complete a pointer or gizmo gesture using the same collision, anchor and history rules. */
export function finishItemMovement(
  store: ConfiguratorStore,
  id: string,
  mode: 'translate' | 'rotate',
  rotation: Euler,
  anchors: Anchor[],
  snaps: ItemSnapPoint[],
): void {
  const state = store.getState()
  const item = state.project?.items.find((entry) => entry.id === id)
  const group = state.itemRegistry.get(id)?.group
  const size = colliderSizeOf(id, state.itemRegistry)
  if (!state.project || !item || !group || !size || !assemblyCanMove(state, id)) {
    restoreLiveItems(state)
    return
  }
  const members = assemblyGroup(id, state.project.items, state.project.connections ?? [])
  if (mode === 'rotate' && members.size > 1) {
    rotateAssembly(store, id, rotation[1] - item.rotation[1])
    return
  }
  group.rotation.set(...rotation)
  const bounds = state.interiorBBox ?? state.enclosureBBox
  const correctPosition = () => {
    const pushed = pushOutOverlaps(id, 8, members, state.itemRegistry)
    const clamped = clampItemToBounds(id, bounds, state.itemRegistry)
    return pushed || clamped
  }
  const position = (): Vec3 => [group.position.x, group.position.y - size[1] / 2, group.position.z]
  const corrected = correctPosition()
  if (mode === 'rotate') {
    const anchor = item.constraints?.find((constraint) => constraint.type === 'snapToAnchor')
    const keepAnchor = !corrected && anchor && anchor.corner == null && anchor.point == null
    commitLiveItemPatches(store, [{ id, patch: {
      position: position(), rotation,
      constraints: keepAnchor ? item.constraints?.map((constraint) => ({ ...constraint })) : withSnapConstraint(item, null),
    } }])
    return
  }
  let hit = findAnchorSnap(position(), rotation[1], size, anchors, snaps)
  if (hit) {
    group.position.set(hit.position[0], hit.position[1] + size[1] / 2, hit.position[2])
    if (correctPosition()) hit = null
  }
  const patches = assemblyPosePatches(state.project.items, members, item, { position: position(), rotation })
  const source = patches.find((entry) => entry.id === id)!
  source.patch.constraints = hit ? withSnapConstraint(item, snapHitConstraint(hit)) : item.constraints
  const connections = jointsSurvivingMove(patches, state.project.connections ?? [])
  commitLiveItemPatches(store, patches,
    connections.length !== (state.project.connections ?? []).length ? connections : undefined)
}
