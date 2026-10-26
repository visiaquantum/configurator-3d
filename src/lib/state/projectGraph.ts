import type { Connection, PlacedItem, ProjectData } from '../types'

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

/** Keep one legacy parent reference per item, derived from the resolved graph. */
export function reconcileConstraints(items: PlacedItem[], connections: Connection[]): PlacedItem[] {
  return items.map((item) => {
    const parent = connections.find((connection) => connection.sourceItemId === item.id)
    const constraints = item.constraints?.filter((constraint) => constraint.type !== 'snapToItem') ?? []
    if (parent) constraints.push({ type: 'snapToItem', target: parent.targetItemId,
      point: parent.sourcePointId, targetPoint: parent.targetPointId })
    return { ...item, constraints }
  })
}

export function removeProjectItems(project: ProjectData, removed: Set<string>): ProjectData {
  const items = project.items.filter((item) => !removed.has(item.id)).map((item) => ({
    ...item,
    constraints: item.constraints?.filter((constraint) =>
      !((constraint.type === 'snapToItem' || constraint.type === 'mirrorPair') &&
        constraint.target && removed.has(constraint.target)),
    ),
  }))
  const connections = project.connections?.filter((connection) =>
    !removed.has(connection.sourceItemId) && !removed.has(connection.targetItemId),
  )
  return { ...project, items: connections ? reconcileConstraints(items, connections) : items, connections }
}
