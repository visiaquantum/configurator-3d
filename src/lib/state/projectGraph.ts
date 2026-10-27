import type { Connection, ItemConstraint, PlacedItem, ProjectData } from '../types'

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

const legacyLink = (connection: Connection): ItemConstraint => ({ type: 'snapToItem', target: connection.targetItemId,
  point: connection.sourcePointId, targetPoint: connection.targetPointId })

const derivesLink = (connection: Connection, itemId: string, constraint: ItemConstraint) =>
  connection.sourceItemId === itemId && connection.targetItemId === constraint.target &&
  connection.sourcePointId === constraint.point && connection.targetPointId === constraint.targetPoint

/** True when either end already records this pair of points as a legacy link. */
const recordsJoint = (items: PlacedItem[], connection: Connection) => items.some((item) => item.constraints?.some((constraint) =>
  constraint.type === 'snapToItem' && (derivesLink(connection, item.id, constraint) || (
    item.id === connection.targetItemId && constraint.target === connection.sourceItemId &&
    constraint.point === connection.targetPointId && constraint.targetPoint === connection.sourcePointId))))

/**
 * Keep one legacy parent reference per item, derived from the resolved graph.
 * A link `previous` never held was not derived from the graph — without a
 * manifest it is the only record of that join — so it is kept until the item
 * gets a parent joint of its own.
 */
export function reconcileConstraints(items: PlacedItem[], connections: Connection[], previous: Connection[] = []): PlacedItem[] {
  return items.map((item) => {
    const parent = connections.find((connection) => connection.sourceItemId === item.id)
    const constraints = item.constraints?.filter((constraint) => constraint.type !== 'snapToItem' ||
      (!parent && !previous.some((connection) => derivesLink(connection, item.id, constraint)))) ?? []
    if (parent) constraints.push(legacyLink(parent))
    return { ...item, constraints }
  })
}

/**
 * Publish a graph edit. While a legacy project is still unresolved, new joints
 * are recorded as legacy links instead: a partial `connections` array would
 * mark the project resolved and strand the links not yet upgraded.
 */
export function withConnections(project: ProjectData, items: PlacedItem[], connections: Connection[]): ProjectData {
  if (project.connections !== undefined) {
    return { ...project, items: reconcileConstraints(items, connections, project.connections), connections }
  }
  const recorded: PlacedItem[] = [...items]
  for (const connection of connections) {
    const index = recorded.findIndex((item) => item.id === connection.sourceItemId)
    const source = recorded[index]
    if (!source || source.constraints?.some((constraint) => constraint.type === 'snapToItem') || recordsJoint(recorded, connection)) continue
    recorded[index] = { ...source, constraints: [...(source.constraints ?? []), legacyLink(connection)] }
  }
  return { ...project, items: recorded }
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
  return connections ? withConnections(project, items, connections) : { ...project, items, connections }
}
