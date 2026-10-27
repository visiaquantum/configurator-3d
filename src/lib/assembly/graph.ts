import type { Connection, ItemConstraint, PlacedItem, ProjectData } from '../types'

/**
 * The assembly graph: the one model every editing operation reads and writes.
 *
 * A joint binds two product snap points. A resolved joint also names both
 * manifest connectors and is exactly a persisted `Connection`. A pending joint
 * is a `snapToItem` link the manifest has not confirmed yet — none is loaded,
 * the products are still hydrating, or the connectors do not match — and is
 * kept as it is until it can be resolved.
 *
 * Storage inside `ProjectData`: resolved joints live in `connections`, pending
 * ones as `snapToItem` constraints on their source item. A `snapToItem` that
 * matches a resolved joint is only that joint's legacy view; the store strips
 * it on import (`toEditableProject`) and adds it back on export
 * (`toPersistedProject`), so nothing in between keeps two structures in step.
 */
export type Joint = Pick<Connection, 'sourceItemId' | 'sourcePointId' | 'targetItemId' | 'targetPointId'> &
  Partial<Pick<Connection, 'sourceConnectorId' | 'targetConnectorId' | 'resolvedTransform'>>

export const isResolvedJoint = (joint: Joint): joint is Connection =>
  !!joint.sourceConnectorId && !!joint.targetConnectorId

/** One key per pair of points, whichever end recorded the joint. */
export const jointKey = (joint: Joint): string =>
  [`${joint.sourceItemId}:${joint.sourcePointId}`, `${joint.targetItemId}:${joint.targetPointId}`].sort().join('|')

/**
 * One joint per pair of points, the first record winning. When both halves of
 * a joint move, each finds it, and two records of the same seat read as a
 * point used twice — and as a cycle.
 */
export function dedupeJoints<T extends Joint>(joints: T[]): T[] {
  const seen = new Set<string>()
  return joints.filter((joint) => {
    const key = jointKey(joint)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const linkOf = (item: PlacedItem, constraint: ItemConstraint): Joint | null =>
  constraint.type === 'snapToItem' && constraint.target && constraint.point && constraint.targetPoint
    ? { sourceItemId: item.id, sourcePointId: constraint.point, targetItemId: constraint.target, targetPointId: constraint.targetPoint }
    : null

const linkConstraint = (joint: Joint): ItemConstraint => ({
  type: 'snapToItem', target: joint.targetItemId, point: joint.sourcePointId, targetPoint: joint.targetPointId,
})

/** Every joint stored in `items` and `connections`, in either project form. */
export function jointsFromParts(items: PlacedItem[], connections: Connection[] = []): Joint[] {
  const resolved = new Set(connections.map(jointKey))
  const pending = items.flatMap((item) => (item.constraints ?? []).flatMap((constraint) => {
    const joint = linkOf(item, constraint)
    return joint && !resolved.has(jointKey(joint)) ? [joint] : []
  }))
  return dedupeJoints<Joint>([...connections, ...pending])
}

export const jointsOf = (project: ProjectData): Joint[] => jointsFromParts(project.items, project.connections)

export const pendingJoints = (project: ProjectData): Joint[] => jointsOf(project).filter((joint) => !isResolvedJoint(joint))

/**
 * Store `joints` as the graph of `project` with `items` as its items. Item
 * `snapToItem` constraints are rebuilt from the pending joints alone, so a
 * patch cannot change the graph behind its back. A project that never had
 * resolved joints keeps `connections` absent, as it was saved.
 */
export function withJoints(project: ProjectData, items: PlacedItem[], joints: Joint[]): ProjectData {
  const unique = dedupeJoints(joints)
  const resolved = unique.filter(isResolvedJoint)
  const pending = new Map<string, ItemConstraint[]>()
  for (const joint of unique) {
    if (!isResolvedJoint(joint)) pending.set(joint.sourceItemId, [...(pending.get(joint.sourceItemId) ?? []), linkConstraint(joint)])
  }
  return {
    ...project,
    items: items.map((item) => {
      const links = pending.get(item.id) ?? []
      const kept = item.constraints?.filter((constraint) => constraint.type !== 'snapToItem')
      if (links.length === 0 && kept?.length === item.constraints?.length) return item
      return { ...item, constraints: [...(kept ?? []), ...links] }
    }),
    connections: project.connections === undefined && resolved.length === 0 ? undefined : resolved,
  }
}

/** Import adapter: drop the legacy view of resolved joints, keep pending links. */
export const toEditableProject = (project: ProjectData): ProjectData => withJoints(project, project.items, jointsOf(project))

/**
 * Export adapter for readers that only understand `snapToItem`: each item that
 * is the source of a resolved joint, and has no pending link, names its first
 * one as its parent. Re-importing strips it again.
 */
export function toPersistedProject(project: ProjectData): ProjectData {
  const connections = project.connections ?? []
  if (connections.length === 0) return project
  return {
    ...project,
    items: project.items.map((item) => {
      if (item.constraints?.some((constraint) => constraint.type === 'snapToItem')) return item
      const parent = connections.find((connection) => connection.sourceItemId === item.id)
      return parent ? { ...item, constraints: [...(item.constraints ?? []), linkConstraint(parent)] } : item
    }),
  }
}

/** Items joined to `id`, in either direction. */
export function jointPartners(joints: Joint[], id: string): Set<string> {
  const out = new Set<string>()
  for (const joint of joints) {
    if (joint.sourceItemId === id) out.add(joint.targetItemId)
    else if (joint.targetItemId === id) out.add(joint.sourceItemId)
  }
  return out
}

/** True when `id` takes part in any joint. */
export const hasJoints = (joints: Joint[], id: string): boolean =>
  joints.some((joint) => joint.sourceItemId === id || joint.targetItemId === id)

/** How many joints use one point of one item. */
export const pointUse = (joints: Joint[], itemId: string, pointId: string): number => joints.filter((joint) =>
  (joint.sourceItemId === itemId && joint.sourcePointId === pointId) ||
  (joint.targetItemId === itemId && joint.targetPointId === pointId)).length

/**
 * Every item that travels with `id`: what it is joined to, what is joined to
 * it, the other half of a mirror pair — followed all the way out. A mirror
 * pair is not a joint: it carries a spacing, not a pair of points, and never
 * enters the graph.
 */
export function assemblyMembers(items: PlacedItem[], joints: Joint[], id: string): Set<string> {
  const neighbours = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b])
    neighbours.set(b, [...(neighbours.get(b) ?? []), a])
  }
  for (const joint of joints) link(joint.sourceItemId, joint.targetItemId)
  for (const item of items) {
    const twin = item.constraints?.find((constraint) => constraint.type === 'mirrorPair')?.target
    if (twin) link(item.id, twin)
  }
  const group = new Set<string>([id])
  const queue = [id]
  while (queue.length > 0) {
    for (const next of neighbours.get(queue.pop()!) ?? []) {
      if (group.has(next)) continue
      group.add(next)
      queue.push(next)
    }
  }
  return group
}

/**
 * The joints a move leaves intact. A joint survives when both its ends travel
 * together: dragging a montante carries the piani seated on it and its mirror
 * twin, and none of those seats move apart. Only a joint with one end left
 * behind is broken by the move — which way round it was recorded says nothing
 * about which end was dragged.
 */
export function jointsSurvivingMove<T extends Joint>(moved: Array<{ id: string }>, joints: T[]): T[] {
  const ids = new Set(moved.map((entry) => entry.id))
  return joints.filter((joint) => ids.has(joint.sourceItemId) === ids.has(joint.targetItemId))
}

/** Joints left once `removed` items leave the project. */
export const jointsWithout = (joints: Joint[], removed: ReadonlySet<string>): Joint[] =>
  joints.filter((joint) => !removed.has(joint.sourceItemId) && !removed.has(joint.targetItemId))
