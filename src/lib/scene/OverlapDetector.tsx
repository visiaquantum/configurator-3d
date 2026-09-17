import { useEffect } from 'react'
import { useConfiguratorStore } from '../state/store'

/**
 * Mirrors the pure assembly validator into the scene's red collision tint.
 *
 * This deliberately does not perform a second, generic AABB pass: a pair of
 * connected items is valid only when `validateConfiguration` proves that its
 * intersection is inside the selected connector's declared clearance zone.
 * Therefore the visual feedback and the BOM/export gate share one rule.
 * Drag-time feedback is supplied by Item's green/red connection ghost.
 */
export function OverlapDetector() {
  const issues = useConfiguratorStore((state) => state.validationIssues)

  useEffect(() => {
    const next = new Set<string>()
    for (const issue of issues) {
      if (issue.level !== 'error') continue
      if (issue.code !== 'collision' && issue.code !== 'out-of-bounds') continue
      issue.itemIds.forEach((id) => next.add(id))
    }
    const previous = useConfiguratorStore.getState().overlappingIds
    if (previous.size === next.size && [...next].every((id) => previous.has(id))) return
    useConfiguratorStore.getState().setOverlappingIds(next)
  }, [issues])

  return null
}
