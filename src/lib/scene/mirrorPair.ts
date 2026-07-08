import type { Euler, ItemConstraint, ItemRule, PlacedItem, Vec3 } from '../types'

/**
 * Math for the `mirror-pair` GLB rule: two identical instances of the same
 * product, mirrored across the plane perpendicular to the rule axis, at a
 * discrete distance `d` (m) between the two rule reference points.
 *
 * All math assumes yaw-only item rotation (the configurator commits X/Y
 * rotations snapped to 90°, but paired products live flat on the floor).
 * The mirror plane is perpendicular to the rule axis: the twin is flipped
 * along the dominant local axis (X or Z) of `rule.axis`, so the rule axis of
 * a mirrored instance automatically points back at its partner — the same
 * formula syncs the pair from either side.
 */

export const MIRROR_PAIR_RULE = 'mirror-pair'

export interface MirrorPairParams {
  distances: number[]
}

export function mirrorPairDistances(rule: ItemRule): number[] {
  const d = (rule.params as Partial<MirrorPairParams>).distances
  return Array.isArray(d) ? d.filter((n): n is number => typeof n === 'number') : []
}

export type MirrorAxis = 'x' | 'z'

/**
 * Local axis the twin is flipped along: the dominant horizontal component of
 * the rule axis (X = side-by-side pair, Z = face-to-face pair).
 */
export function mirrorAxisOf(rule: ItemRule): MirrorAxis {
  return Math.abs(rule.axis[0]) >= Math.abs(rule.axis[2]) ? 'x' : 'z'
}

/** Reflect a local-frame vector across the plane perpendicular to `axis`. */
const reflect = (v: Vec3, axis: MirrorAxis): Vec3 =>
  axis === 'x' ? [-v[0], v[1], v[2]] : [v[0], v[1], -v[2]]

/** Rotate a vector by `yaw` radians around +Y. */
function rotY(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]

export interface PairSource {
  position: Vec3
  rotation: Euler
  mirrored?: boolean
}

export interface PartnerPlacement {
  position: Vec3
  rotation: Euler
  mirrored: boolean
}

/**
 * Where the partner of `source` must sit so the pair keeps the rule geometry:
 * rule points `d` apart along the source's world rule axis, partner mirrored.
 */
export function computePartnerPlacement(
  source: PairSource,
  rule: ItemRule,
  distance: number,
): PartnerPlacement {
  const yaw = source.rotation[1]
  const srcMirrored = source.mirrored === true
  const axis = mirrorAxisOf(rule)

  const localOffset = srcMirrored ? reflect(rule.position, axis) : rule.position
  const localAxis = srcMirrored ? reflect(rule.axis, axis) : rule.axis

  // World rule point and axis of the source instance.
  const p = add(source.position, rotY(localOffset, yaw))
  const u = rotY(localAxis, yaw)

  // Partner rule point, then back from its (mirrored) local offset to its center.
  const partnerMirrored = !srcMirrored
  const partnerLocalOffset = partnerMirrored ? reflect(rule.position, axis) : rule.position
  const partnerPos = sub(add(p, scale(u, distance)), rotY(partnerLocalOffset, yaw))

  return {
    position: partnerPos,
    rotation: [source.rotation[0], source.rotation[1], source.rotation[2]],
    mirrored: partnerMirrored,
  }
}

/** The mirrorPair constraint on an item, if any. */
export function mirrorPairConstraint(item: PlacedItem) {
  return item.constraints?.find((c) => c.type === 'mirrorPair')
}

/**
 * Merge a new snap-to-anchor constraint (or none) with the item's existing
 * constraints, preserving any mirrorPair link. Commit paths in Item.tsx use
 * this instead of overwriting `constraints` wholesale.
 */
export function withSnapConstraint(item: PlacedItem, snap: ItemConstraint | null) {
  const kept = item.constraints?.filter((c) => c.type === 'mirrorPair') ?? []
  return snap ? [...kept, snap] : kept
}
