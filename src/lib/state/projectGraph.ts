import type { PlacedItem, ProjectData } from '../types'
import { jointsOf, jointsWithout, withJoints } from '../assembly/graph'

/** Moving an item away from its old enclosure anchor releases that anchor. */
export function applyItemPatch(item: PlacedItem, patch: Partial<PlacedItem>): PlacedItem {
  const moved = (patch.position && patch.position.some((value, index) => value !== item.position[index])) ||
    (patch.rotation && patch.rotation.some((value, index) => value !== item.rotation[index]))
  const inheritsConstraints = patch.constraints === undefined || patch.constraints === item.constraints
  return {
    ...item,
    ...patch,
    ...(moved && inheritsConstraints ? { constraints: item.constraints?.filter((constraint) => constraint.type !== 'snapToAnchor') } : {}),
  }
}

/** Remove items together with their joints and the mirror links pointing at them. */
export function removeProjectItems(project: ProjectData, removed: Set<string>): ProjectData {
  const items = project.items.filter((item) => !removed.has(item.id)).map((item) => ({
    ...item,
    constraints: item.constraints?.filter((constraint) =>
      !(constraint.type === 'mirrorPair' && constraint.target && removed.has(constraint.target)),
    ),
  }))
  return withJoints(project, items, jointsWithout(jointsOf(project), removed))
}
