import { Vector3, Euler as ThreeEuler, Quaternion } from 'three'
import type { Connection, Euler, ItemRule, ItemSnapPoint, PlacedItem, Vec3 } from '../types'
import { getItem } from './itemRegistry'
import type { ItemRegistry } from './itemRegistry'
import { rotateVector } from './geometry'
import { AUTO_GRID_SNAP_KIND } from '../io/autoSnapGrid'
import { MIRROR_PAIR_RULE, mirrorAxisOf } from './mirrorPair'
import { assemblyMembers, jointPartners, jointsFromParts } from '../assembly/graph'
import { own } from '../util/record'

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
  return own(SNAP_KIND_LABELS, kind) ?? kind
}

/** Readable name for one point: "Foro r3 c2", "Facciata 2", "Base a terra". */
export function snapPointLabel(p: ItemSnapPoint): string {
  if (p.label) return p.label
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

/** True when some kind may join `kind`; reference-only kinds (`origine`) and unknown ones may not. */
export function kindMatesWithAny(kind: string): boolean {
  return (own(MATING_RULES, kind)?.length ?? 0) > 0 || Object.values(MATING_RULES).some((kinds) => kinds.includes(kind))
}

/** True when the two kinds are declared compatible (order-insensitive). */
export function canMate(a: string, b: string): boolean {
  return (own(MATING_RULES, a)?.includes(b) ?? false) || (own(MATING_RULES, b)?.includes(a) ?? false)
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
export function worldSnapPosition(itemId: string, local: Vec3, registry: ItemRegistry): Vec3 | null {
  const reg = getItem(itemId, registry)
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
  registry: ItemRegistry,
  opts: { all?: boolean } = {},
): MatingTarget[] {
  const out: MatingTarget[] = []
  for (const [itemId, points] of snapsByItem) {
    if (itemId === sourceItemId) continue
    for (const point of points) {
      const compatible = canMate(sourceKind, point.kind)
      if (!compatible && !opts.all) continue
      const position = worldSnapPosition(itemId, point.position, registry)
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
  yaw: number | Euler,
  colliderHeight: number,
  target: Vec3,
): Vec3 {
  const offset = rotateVector(myPoint, typeof yaw === 'number' ? [0, yaw, 0] : yaw)
  return [target[0] - offset[0], target[1] - colliderHeight / 2 - offset[1], target[2] - offset[2]]
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
  const snaps = own(itemSnaps, item.catalogId)
  if (!snaps) return []
  const mirrorScale = mirrorScaleFor(item, itemRules)
  return mirrorScale ? mirrorSnapPoints(snaps, mirrorScale) : snaps
}

/**
 * The flip an item's own local frame carries when it is the mirrored half of
 * a pair, or `null` when it is not. Everything read from the catalogue in that
 * frame goes through this — points, and the clearance boxes that say where a
 * joint may interpenetrate. Miss one and the mirrored half rejects the very
 * joint its twin accepts.
 */
export function mirrorScaleFor(
  item: Pick<PlacedItem, 'mirrored' | 'catalogId'>,
  itemRules: Record<string, ItemRule[]>,
): Vec3 | null {
  if (item.mirrored !== true) return null
  const rule = own(itemRules, item.catalogId)?.find((r) => r.rule === MIRROR_PAIR_RULE)
  return rule && mirrorAxisOf(rule) === 'z' ? [1, 1, -1] : [-1, 1, 1]
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
 * would fight the assembly apart the moment anything moves. Reads both
 * project forms: resolved `connections` and pending or legacy `snapToItem`.
 */
export function linkedPartners(id: string, items: PlacedItem[], connections: Connection[] = []): Set<string> {
  return jointPartners(jointsFromParts(items, connections), id)
}

/**
 * Every item that travels with `id`: what it is bolted to, what is bolted to
 * it, what carries it, the other half of a mirror pair — followed all the way
 * out. A frame is one object to the person moving it, whichever member they
 * happen to grab, and a member left behind is a joint prised open.
 */
export function assemblyGroup(
  id: string,
  items: PlacedItem[],
  connections: Connection[] = [],
): Set<string> {
  return assemblyMembers(items, jointsFromParts(items, connections), id)
}

/**
 * Turning a whole assembly: every member swung by `step` about the vertical
 * axis through `pivot`, position and heading together.
 *
 * Rigid, like the translate — re-deriving each pose from its seat cannot turn a
 * frame, because a seat says where a part sits, not which way the frame faces.
 * The pivot is the part the person acted on, so that one stays where it is and
 * the rest swings around it.
 */
export function rotateGroupPatches(
  items: PlacedItem[],
  group: Set<string>,
  pivot: Vec3,
  step: number,
): Array<{ id: string; patch: Partial<PlacedItem> }> {
  const cos = Math.cos(step)
  const sin = Math.sin(step)
  return items
    .filter((item) => group.has(item.id))
    .map((item) => {
      const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), step)
      const quaternion = new Quaternion().setFromEuler(new ThreeEuler(...item.rotation)).premultiply(turn)
      const euler = new ThreeEuler().setFromQuaternion(quaternion)
      const dx = item.position[0] - pivot[0]
      const dz = item.position[2] - pivot[2]
      return {
        id: item.id,
        patch: {
          // Same yaw convention as positionForItemSnap.
          position: [pivot[0] + dx * cos + dz * sin, item.position[1], pivot[2] - dx * sin + dz * cos] as Vec3,
          rotation: item.rotation[0] === 0 && item.rotation[2] === 0
            ? [0, item.rotation[1] + step, 0] as Euler
            : [euler.x, euler.y, euler.z] as Euler,
        },
      }
    })
}

/** Pure rigid placement of a complete assembly, used by previews and commits. */
export function assemblyPosePatches(items: PlacedItem[], group: Set<string>, source: PlacedItem, pose: { position: Vec3; rotation: Euler }) {
  return rotateGroupPatches(items, group, source.position, pose.rotation[1] - source.rotation[1]).map(({ id, patch }) => ({
    id,
    patch: id === source.id ? { position: pose.position, rotation: pose.rotation } : {
      ...patch,
      position: patch.position!.map((value, index) => value + pose.position[index] - source.position[index]) as Vec3,
    },
  }))
}

export { dedupeJoints, jointsSurvivingMove } from '../assembly/graph'
