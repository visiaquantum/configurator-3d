import { Box3, Vector3 } from 'three'
import {
  getItem,
  getWorldAABB,
  getWorldCorners,
  listOtherItems,
} from './itemRegistry'

/** Default vertex-to-vertex snap distance — 3 cm. */
export const VERTEX_SNAP_RADIUS = 0.03
/** Once snapped, the lock only releases once the corners drift beyond this. */
export const VERTEX_SNAP_RELEASE_RADIUS = 0.06

export interface VertexSnapResult {
  /**
   * Translation to apply to the dragged item so its corner meets the target.
   * This Vector3 is module-pooled — read immediately and don't retain it.
   */
  offset: Vector3
  dist: number
  myCornerIdx: number
  otherCornerIdx: number
  /** Id of the other item the snap is against. */
  otherId: string
}

// Scratch — drag-time math is single-threaded and read immediately, so we
// reuse these instead of allocating a Vector3 each call.
const _myCorners: Vector3[] = Array.from({ length: 8 }, () => new Vector3())
const _otherCorners: Vector3[] = Array.from({ length: 8 }, () => new Vector3())
const _snapOffset = new Vector3()
const _snapResult: VertexSnapResult = {
  offset: _snapOffset,
  dist: 0,
  myCornerIdx: 0,
  otherCornerIdx: 0,
  otherId: '',
}
const _lockOffset = new Vector3()
const _lockResult = { offset: _lockOffset, dist: 0 }
const _myBox = new Box3()
const _otherBox = new Box3()
const _mtvVec = new Vector3()

/**
 * Find the closest corner-to-corner snap between item `myId` and any other
 * registered item, within `threshold` world units. Returns the translation
 * needed to align the matched corners, or null if nothing is in range.
 *
 * NOTE: the returned object and its `offset` Vector3 are module-pooled — read
 * them right after the call. They are overwritten on the next invocation.
 */
export function findNearestVertexSnap(
  myId: string,
  threshold = VERTEX_SNAP_RADIUS,
): VertexSnapResult | null {
  const me = getItem(myId)
  if (!me) return null
  getWorldCorners(me, _myCorners)

  let bestDist = Infinity
  let bestI = -1
  let bestJ = -1
  let bestOtherId = ''
  let bestOx = 0
  let bestOy = 0
  let bestOz = 0

  for (const other of listOtherItems(myId)) {
    getWorldCorners(other, _otherCorners)
    for (let i = 0; i < 8; i++) {
      const mc = _myCorners[i]
      for (let j = 0; j < 8; j++) {
        const oc = _otherCorners[j]
        const dx = oc.x - mc.x
        const dy = oc.y - mc.y
        const dz = oc.z - mc.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d <= threshold && d < bestDist) {
          bestDist = d
          bestI = i
          bestJ = j
          bestOtherId = other.id
          bestOx = dx
          bestOy = dy
          bestOz = dz
        }
      }
    }
  }
  if (bestI < 0) return null
  _snapOffset.set(bestOx, bestOy, bestOz)
  _snapResult.dist = bestDist
  _snapResult.myCornerIdx = bestI
  _snapResult.otherCornerIdx = bestJ
  _snapResult.otherId = bestOtherId
  return _snapResult
}

/**
 * Compute the translation needed to re-align a specific corner pair, given
 * the current world positions of both items' corners. Returns null if either
 * item is no longer registered.
 *
 * Like findNearestVertexSnap, the returned object's `offset` is pooled.
 */
export function offsetForLockedCorners(
  myId: string,
  myCornerIdx: number,
  otherId: string,
  otherCornerIdx: number,
): { offset: Vector3; dist: number } | null {
  const me = getItem(myId)
  const other = getItem(otherId)
  if (!me || !other) return null
  getWorldCorners(me, _myCorners)
  getWorldCorners(other, _otherCorners)
  const mc = _myCorners[myCornerIdx]
  const oc = _otherCorners[otherCornerIdx]
  const dx = oc.x - mc.x
  const dy = oc.y - mc.y
  const dz = oc.z - mc.z
  _lockOffset.set(dx, dy, dz)
  _lockResult.dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return _lockResult
}

/**
 * Resolve any overlap between item `myId` and other registered items by
 * translating `myId`'s group along the axis of minimum horizontal penetration.
 * Y axis is intentionally ignored — items rest on the floor and we never
 * want to lift them vertically to escape an overlap.
 */
export function pushOutOverlaps(myId: string, maxIter = 8): void {
  const me = getItem(myId)
  if (!me) return

  for (let iter = 0; iter < maxIter; iter++) {
    getWorldAABB(me, _myBox)
    let pushedThisPass = false
    for (const other of listOtherItems(myId)) {
      getWorldAABB(other, _otherBox)
      if (horizontalMTV(_myBox, _otherBox, _mtvVec)) {
        me.group.position.add(_mtvVec)
        pushedThisPass = true
      }
    }
    if (!pushedThisPass) return
  }
}

const EPSILON = 1e-6

/**
 * Minimum translation vector to separate AABBs `a` (the one we will move)
 * and `b` along the smaller of the X/Z penetrations. Writes into `out` and
 * returns true if a push was needed; returns false (and leaves `out`
 * untouched) when the boxes don't intersect on all three axes.
 */
function horizontalMTV(a: Box3, b: Box3, out: Vector3): boolean {
  const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)
  const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)
  const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)
  if (overlapX <= EPSILON || overlapY <= EPSILON || overlapZ <= EPSILON) return false

  const ax = (a.min.x + a.max.x) / 2
  const az = (a.min.z + a.max.z) / 2
  const bx = (b.min.x + b.max.x) / 2
  const bz = (b.min.z + b.max.z) / 2

  if (overlapX <= overlapZ) {
    out.set(ax < bx ? -overlapX : overlapX, 0, 0)
  } else {
    out.set(0, 0, az < bz ? -overlapZ : overlapZ)
  }
  return true
}
