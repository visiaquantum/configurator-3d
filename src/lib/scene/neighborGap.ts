import { Box3 } from 'three'
import type { Vec3 } from '../types'
import { getItem, getWorldAABB, listOtherItems } from './itemRegistry'

/**
 * Product-to-product distance measurement.
 *
 * Both items are reduced to their world AABBs. Per axis the *gap* is the
 * face-to-face separation, negative when the two boxes overlap on that axis:
 *
 *   gap[a] = max(B.min[a] - A.max[a], A.min[a] - B.max[a])
 *
 * The reported axis is the nearest one: the axis with the **smallest positive**
 * gap. Axes where the boxes overlap carry no distance, so they are skipped; if
 * no axis has a positive gap the boxes intersect and there is nothing to
 * measure (that case is already flagged in red by OverlapDetector).
 */

export type GapAxis = 'x' | 'y' | 'z'

export interface NeighborGap {
  /** Item the measurement starts from (the selected one). */
  itemId: string
  /** Nearest other product. */
  otherId: string
  axis: GapAxis
  /** Face-to-face distance (m) along `axis`. */
  distance: number
  /** World-space endpoints of the measured segment. */
  from: Vec3
  to: Vec3
}

/** Beyond this the items aren't "near" each other and no label is shown. */
export const NEIGHBOR_GAP_MAX_RANGE = 1.0

const AXES: GapAxis[] = ['x', 'y', 'z']
// Module-scope scratch — this runs once per frame, so it must not allocate.
const _a = new Box3()
const _b = new Box3()
const _best = new Box3()

interface AxisGaps {
  x: number
  y: number
  z: number
}

function axisGaps(a: Box3, b: Box3): AxisGaps {
  return {
    x: Math.max(b.min.x - a.max.x, a.min.x - b.max.x),
    y: Math.max(b.min.y - a.max.y, a.min.y - b.max.y),
    z: Math.max(b.min.z - a.max.z, a.min.z - b.max.z),
  }
}

/** True 3D distance between the two AABBs (0 when they intersect). */
function aabbDistance(g: AxisGaps): number {
  const gx = Math.max(g.x, 0)
  const gy = Math.max(g.y, 0)
  const gz = Math.max(g.z, 0)
  return Math.sqrt(gx * gx + gy * gy + gz * gz)
}

function nearestAxis(g: AxisGaps): GapAxis | null {
  let best: GapAxis | null = null
  for (const a of AXES) {
    if (g[a] <= 0) continue
    if (best === null || g[a] < g[best]) best = a
  }
  return best
}

/**
 * Lateral placement of the measurement segment on a non-measured axis: the
 * middle of the shared span. When the boxes don't overlap on that axis the
 * bounds cross over and the same formula lands between the two facing faces.
 */
function sharedMid(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return (Math.max(aMin, bMin) + Math.min(aMax, bMax)) / 2
}

/**
 * Nearest-product measurement for `itemId`, or null when nothing is in range,
 * the item is unknown, or the closest neighbour is intersecting it.
 * Neighbour choice is by true AABB distance; the axis is then the nearest one.
 */
export function computeNeighborGap(
  itemId: string,
  maxRange = NEIGHBOR_GAP_MAX_RANGE,
): NeighborGap | null {
  const me = getItem(itemId)
  if (!me) return null
  getWorldAABB(me, _a)

  let bestDist = Infinity
  let bestGaps: AxisGaps | null = null
  let bestId: string | null = null

  for (const other of listOtherItems(itemId)) {
    getWorldAABB(other, _b)
    const g = axisGaps(_a, _b)
    const d = aabbDistance(g)
    if (d >= bestDist) continue
    bestDist = d
    bestGaps = g
    bestId = other.id
    _best.copy(_b)
  }

  if (!bestGaps || !bestId || bestDist > maxRange) return null

  const axis = nearestAxis(bestGaps)
  if (!axis) return null // intersecting on every axis

  const distance = bestGaps[axis]
  // Which side of the neighbour we sit on decides which faces to connect.
  const meIsLower = _a.max[axis] <= _best.min[axis]
  const fromV = meIsLower ? _a.max[axis] : _a.min[axis]
  const toV = meIsLower ? _best.min[axis] : _best.max[axis]

  const midX = sharedMid(_a.min.x, _a.max.x, _best.min.x, _best.max.x)
  const midY = sharedMid(_a.min.y, _a.max.y, _best.min.y, _best.max.y)
  const midZ = sharedMid(_a.min.z, _a.max.z, _best.min.z, _best.max.z)

  const from: Vec3 = [midX, midY, midZ]
  const to: Vec3 = [midX, midY, midZ]
  const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  from[idx] = fromV
  to[idx] = toV

  return { itemId, otherId: bestId, axis, distance, from, to }
}
