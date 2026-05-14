import { useRef } from 'react'
import { Box3 } from 'three'
import { useFrame } from '@react-three/fiber'
import { useConfiguratorStore } from '../state/store'
import { listOtherItems, getWorldAABB, getItem } from './itemRegistry'

const EPS = 1e-6
const _a = new Box3()
const _b = new Box3()

function aabbOverlaps(a: Box3, b: Box3): boolean {
  return (
    a.max.x - b.min.x > EPS &&
    b.max.x - a.min.x > EPS &&
    a.max.y - b.min.y > EPS &&
    b.max.y - a.min.y > EPS &&
    a.max.z - b.min.z > EPS &&
    b.max.z - a.min.z > EPS
  )
}

/**
 * Recomputes the set of items whose AABB intersects another item's, and
 * pushes it into the store. O(N²) per frame on the placed-item count — fine
 * for a typical van layout (<50 items). Updates store only when the set
 * actually changes, so non-overlapping subscribers don't re-render.
 */
export function OverlapDetector() {
  const prevRef = useRef<Set<string>>(new Set())

  useFrame(() => {
    const project = useConfiguratorStore.getState().project
    if (!project) return
    const next = new Set<string>()
    for (let i = 0; i < project.items.length; i++) {
      const a = getItem(project.items[i].id)
      if (!a) continue
      getWorldAABB(a, _a)
      for (const other of listOtherItems(a.id)) {
        getWorldAABB(other, _b)
        if (aabbOverlaps(_a, _b)) {
          next.add(a.id)
          next.add(other.id)
        }
      }
    }
    // Compare to previous; update store only on set change.
    const prev = prevRef.current
    if (prev.size === next.size) {
      let same = true
      for (const id of next) {
        if (!prev.has(id)) {
          same = false
          break
        }
      }
      if (same) return
    }
    prevRef.current = next
    useConfiguratorStore.getState().setOverlappingIds(next)
  })

  return null
}
