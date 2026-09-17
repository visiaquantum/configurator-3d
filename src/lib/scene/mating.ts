import { Vector3 } from 'three'
import type { Connection, Euler, ItemConstraint, ItemRule, ItemSnapPoint, PlacedItem, Vec3 } from '../types'
import { colliderSizeOf, getItem } from './itemRegistry'
import { AUTO_GRID_SNAP_KIND } from '../io/autoSnapGrid'
import { MIRROR_PAIR_RULE, mirrorAxisOf } from './mirrorPair'

/**
 * Which product snap points may be joined to which.
 *
 * Kinds come from the GLB node names (`SNAP_<KIND>`, see io/itemSnaps.ts) —
 * the only channel available, since the customer's CAD export cannot write
 * glTF extras. The table below is a *filter*, not a correctness rule: the
 * person configuring always picks the target explicitly, so an unlisted pair
 * is merely demoted, never impossible (see `listMatingTargets(..., { all })`).
 *
 * Observed kinds in the Sincro catalogue:
 *   terra            base of an upright — rests on the enclosure floor
 *   laterale         side face — uprights standing next to each other
 *   frontale         front face — where shelves and accessories mount
 *   sovrapposizione  top face — an upright stacked on another
 *   origine          model origin, reference only, never mates
 *   foro             generated hole centre (auto-snap-grid)
 */
export const MATING_RULES: Record<string, string[]> = {
  laterale: ['laterale'],
  sovrapposizione: ['sovrapposizione'],
  frontale: ['frontale', AUTO_GRID_SNAP_KIND],
  [AUTO_GRID_SNAP_KIND]: ['frontale', AUTO_GRID_SNAP_KIND],
  // `terra` mates with enclosure floor anchors, not with other products.
  terra: [],
  origine: [],
}

/** Human labels for the UI. Unknown kinds fall back to the raw kind. */
export const SNAP_KIND_LABELS: Record<string, string> = {
  terra: 'Base a terra',
  laterale: 'Lato',
  frontale: 'Facciata',
  sovrapposizione: 'Sovrapposizione',
  origine: 'Origine',
  [AUTO_GRID_SNAP_KIND]: 'Foro',
}

export function snapKindLabel(kind: string): string {
  return SNAP_KIND_LABELS[kind] ?? kind
}

/** Readable name for one point: "Foro r3 c2", "Facciata 2", "Base a terra". */
export function snapPointLabel(p: ItemSnapPoint): string {
  const base = snapKindLabel(p.kind)
  if (p.kind === AUTO_GRID_SNAP_KIND) {
    const m = p.id.match(/-r(\d+)-c(\d+)$/)
    if (m) return `${base} r${m[1]} c${m[2]}`
  }
  const suffix = p.id.startsWith(`${p.kind}-`) ? p.id.slice(p.kind.length + 1) : null
  if (suffix) return `${base} ${suffix}`
  // An id the extractor would never generate was authored by the catalogue
  // (`shelf-top`, `end-a`). Show it: otherwise every declared point of a kind
  // reads as the same bare label and the join picker cannot tell them apart.
  return p.id === p.kind ? base : `${base} · ${p.id}`
}

/** True when the two kinds are declared compatible (order-insensitive). */
export function canMate(a: string, b: string): boolean {
  return (MATING_RULES[a]?.includes(b) ?? false) || (MATING_RULES[b]?.includes(a) ?? false)
}

/**
 * Mirror a point set along `mirrorScale` (the flip applied to a mirror-pair
 * twin). Position and face normal both flip.
 */
export function mirrorSnapPoints(
  snaps: ItemSnapPoint[] | undefined,
  mirrorScale: Vec3 | undefined,
): ItemSnapPoint[] {
  if (!snaps) return []
  if (!mirrorScale) return snaps
  return snaps.map((sp) => ({
    ...sp,
    position: [
      sp.position[0] * mirrorScale[0],
      sp.position[1] * mirrorScale[1],
      sp.position[2] * mirrorScale[2],
    ] as Vec3,
    normal: sp.normal
      ? ([
          sp.normal[0] * mirrorScale[0],
          sp.normal[1] * mirrorScale[1],
          sp.normal[2] * mirrorScale[2],
        ] as Vec3)
      : undefined,
  }))
}

/** One candidate destination: a point on another product, in world space. */
export interface MatingTarget {
  itemId: string
  point: ItemSnapPoint
  /** World position of the point right now. */
  position: Vec3
  /** True when the kinds are declared compatible in MATING_RULES. */
  compatible: boolean
}

const _v = new Vector3()

/** World position of an item-local snap point, or null if the item is gone. */
export function worldSnapPosition(itemId: string, local: Vec3): Vec3 | null {
  const reg = getItem(itemId)
  if (!reg) return null
  reg.group.updateWorldMatrix(true, false)
  _v.set(local[0], local[1], local[2]).applyMatrix4(reg.group.matrixWorld)
  return [_v.x, _v.y, _v.z]
}

/**
 * Every snap point of every *other* live item that `sourceKind` may join,
 * in world space. `all` keeps incompatible pairs in the list (demoted via
 * `compatible: false`) so the UI can offer an escape hatch.
 *
 * `snapsByItem` maps item id → that item's points already in its own local
 * frame and already mirrored (see `mirrorSnapPoints`).
 */
export function listMatingTargets(
  sourceItemId: string,
  sourceKind: string,
  snapsByItem: Map<string, ItemSnapPoint[]>,
  opts: { all?: boolean } = {},
): MatingTarget[] {
  const out: MatingTarget[] = []
  for (const [itemId, points] of snapsByItem) {
    if (itemId === sourceItemId) continue
    for (const point of points) {
      const compatible = canMate(sourceKind, point.kind)
      if (!compatible && !opts.all) continue
      const position = worldSnapPosition(itemId, point.position)
      if (!position) continue
      out.push({ itemId, point, position, compatible })
    }
  }
  return out
}

/**
 * Base position that puts the source item's `myPoint` exactly on `target`.
 *
 * Translation only — the item keeps its rotation, exactly like the enclosure
 * anchor snap. `myPoint` is in the item's local frame (origin at collider
 * centre), so it must be rotated by the item's yaw before subtracting.
 * `colliderHeight` converts the collider centre back to the stored base Y.
 */
export function positionForItemSnap(
  myPoint: Vec3,
  yaw: number,
  colliderHeight: number,
  target: Vec3,
): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const dx = myPoint[0] * c + myPoint[2] * s
  const dz = -myPoint[0] * s + myPoint[2] * c
  return [
    target[0] - dx,
    target[1] - (myPoint[1] + colliderHeight / 2),
    target[2] - dz,
  ]
}

/** The `snapToItem` constraint on an item, if any. */
export function itemSnapConstraint(item: PlacedItem): ItemConstraint | undefined {
  return item.constraints?.find((c) => c.type === 'snapToItem')
}

/** Build the constraint recording a product-to-product join. */
export function itemSnapConstraintFor(
  targetItemId: string,
  myPointId: string,
  targetPointId: string,
): ItemConstraint {
  return {
    type: 'snapToItem',
    target: targetItemId,
    point: myPointId,
    targetPoint: targetPointId,
  }
}

export interface AssemblyContext {
  items: PlacedItem[]
  /** That item's snap points in its own local frame, already mirrored. */
  snapsFor: (item: PlacedItem) => ItemSnapPoint[]
}

/**
 * Re-place every item joined to `movedId` (and, transitively, everything
 * joined to those) so the assembly follows the piece that just moved.
 *
 * Live Three.js groups are updated as we go, because a child's own children
 * resolve against its refreshed world matrix. The returned patches commit the
 * same transforms to the store in one undo step — the same contract as
 * `pairSyncPatches` for mirror pairs.
 *
 * Cycles are impossible to express through the UI but cheap to guard against,
 * so a visited set caps the walk.
 */
export function resolveSnappedChildren(
  movedId: string,
  ctx: AssemblyContext,
): Array<{ id: string; patch: Partial<PlacedItem> }> {
  const patches: Array<{ id: string; patch: Partial<PlacedItem> }> = []
  const visited = new Set<string>([movedId])
  const byId = new Map(ctx.items.map((it) => [it.id, it]))

  const walk = (parentId: string) => {
    const parent = byId.get(parentId)
    if (!parent) return
    const parentPoints = ctx.snapsFor(parent)

    for (const child of ctx.items) {
      if (visited.has(child.id)) continue
      const c = itemSnapConstraint(child)
      if (c?.target !== parentId || !c.point || !c.targetPoint) continue

      const myPoint = ctx.snapsFor(child).find((p) => p.id === c.point)
      const targetPoint = parentPoints.find((p) => p.id === c.targetPoint)
      if (!myPoint || !targetPoint) continue

      const targetWorld = worldSnapPosition(parentId, targetPoint.position)
      const size = colliderSizeOf(child.id)
      if (!targetWorld || !size) continue

      // Re-derive the mating orientation from the two faces rather than
      // tracking a rotation delta: turning the parent turns the child with it,
      // and the result cannot drift over repeated moves.
      const yaw = yawToMate(myPoint.normal, targetPoint.normal, parent.rotation[1])
      const rotation: Euler =
        yaw === null ? child.rotation : [child.rotation[0], yaw, child.rotation[2]]

      const position = positionForItemSnap(
        myPoint.position,
        rotation[1],
        size[1],
        targetWorld,
      )

      const reg = getItem(child.id)
      if (reg) {
        reg.group.position.set(position[0], position[1] + size[1] / 2, position[2])
        reg.group.rotation.set(rotation[0], rotation[1], rotation[2])
        reg.group.updateWorldMatrix(true, false)
      }

      visited.add(child.id)
      patches.push({ id: child.id, patch: { position, rotation } })
      walk(child.id)
    }
  }

  walk(movedId)
  return patches
}

/**
 * Snap points of one item in its own local frame, mirrored when the item is
 * the flipped half of a mirror pair. Single source of truth for every caller
 * that needs to reason about an item's points.
 */
export function snapsForItem(
  item: PlacedItem,
  itemSnaps: Record<string, ItemSnapPoint[]>,
  itemRules: Record<string, ItemRule[]>,
): ItemSnapPoint[] {
  const snaps = itemSnaps[item.catalogId]
  if (!snaps) return []
  if (item.mirrored !== true) return snaps
  const rule = itemRules[item.catalogId]?.find((r) => r.rule === MIRROR_PAIR_RULE)
  const mirrorScale: Vec3 = rule && mirrorAxisOf(rule) === 'z' ? [1, 1, -1] : [-1, 1, 1]
  return mirrorSnapPoints(snaps, mirrorScale)
}

/** Assembly context built from the current store snapshot. */
export function assemblyContext(
  items: PlacedItem[],
  itemSnaps: Record<string, ItemSnapPoint[]>,
  itemRules: Record<string, ItemRule[]>,
): AssemblyContext {
  return {
    items,
    snapsFor: (it) => snapsForItem(it, itemSnaps, itemRules),
  }
}

/** Rotate a vector by `yaw` radians around +Y (three.js convention). */
function rotY(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

/** The item rotations this configurator commits — 90° steps around Y. */
const QUARTER_TURNS = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
/** Two faces count as opposed above this dot product (≈25° of slack). */
const MATE_ALIGNMENT_MIN_DOT = 0.9

/**
 * Yaw that turns this item so `myNormal` faces straight into `targetNormal` —
 * the two mating faces pressed against each other, as in a CAD coincident
 * mate. Returns null when no quarter turn achieves it, which is the case
 * whenever either face points up or down: yaw cannot tilt a horizontal face,
 * so the item keeps the rotation it has.
 */
export function yawToMate(
  myNormal: Vec3 | undefined,
  targetNormal: Vec3 | undefined,
  targetYaw: number,
): number | null {
  if (!myNormal || !targetNormal) return null
  const horizontal = (v: Vec3) => Math.hypot(v[0], v[2]) > 0.5
  if (!horizontal(myNormal) || !horizontal(targetNormal)) return null

  const tw = rotY(targetNormal, targetYaw)
  const desired: Vec3 = [-tw[0], -tw[1], -tw[2]]

  let best: number | null = null
  let bestDot = -Infinity
  for (const yaw of QUARTER_TURNS) {
    const n = rotY(myNormal, yaw)
    const dot = n[0] * desired[0] + n[2] * desired[2]
    if (dot > bestDot) {
      bestDot = dot
      best = yaw
    }
  }
  return bestDot >= MATE_ALIGNMENT_MIN_DOT ? best : null
}

/**
 * Ids joined to `id` in either direction — its parent and its children.
 *
 * Interlocking parts share material by design, so the overlap push-out and the
 * red "collision" tint must skip these pairs; otherwise the collision system
 * would fight the assembly apart the moment anything moves.
 *
 * `connections` matter as much as the constraint: a part is positioned by one
 * parent but bolted at several points, so an upright joined to three
 * horizontals has one `snapToItem` target and three real joints. Reading only
 * the constraint would leave the other two pairs to be prised apart.
 */
export function linkedPartners(id: string, items: PlacedItem[], connections: Connection[] = []): Set<string> {
  const out = new Set<string>()
  const self = items.find((it) => it.id === id)
  const parent = self ? itemSnapConstraint(self)?.target : undefined
  if (parent) out.add(parent)
  for (const it of items) {
    if (itemSnapConstraint(it)?.target === id) out.add(it.id)
  }
  for (const connection of connections) {
    if (connection.sourceItemId === id) out.add(connection.targetItemId)
    else if (connection.targetItemId === id) out.add(connection.sourceItemId)
  }
  return out
}
