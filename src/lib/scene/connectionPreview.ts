import type { ConfiguratorState, ConfiguratorStore } from '../state/store'
import type { Connection, Euler, ItemSnapPoint, Vec3 } from '../types'
import { connectorForSnap, connectorsCanMate, definitionFor } from '../assembly/manifest'
import { assemblyPosePatches, listMatingTargets, positionForItemSnap, snapsForItem, worldSnapPosition, yawToMate } from './mating'
import { assemblyMembers, dedupeJoints, jointsOf, jointsSurvivingMove } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import { itemHeight, previewAssemblyPlacement } from './assemblyPlacement'
import { assemblyCanMove, commitLiveItemPatches, restoreLiveItems } from './itemMovement'

const CONNECTION_SNAP_RADIUS = 0.12

export interface ConnectionPreview {
  position: Vec3
  rotation: Euler
  connection: Connection
  /** The whole graph once the part sits in this seat. */
  joints: Joint[]
  valid: boolean
  reason?: string
}

/** Read the live pointer/gizmo pose; the returned proposal never mutates it. */
export function resolveConnectionPreview(s: ConfiguratorState, itemId: string): ConnectionPreview | null {
  const item = s.project?.items.find((entry) => entry.id === itemId)
  const group = s.itemRegistry.get(itemId)?.group
  if (!s.project || !s.assemblyManifest || !item || !group) return null
  const sourceDefinition = definitionFor(s.assemblyManifest, item.catalogId)
  if (!sourceDefinition) return null
  // A part cannot be joined to what is travelling with it. Its own seat moves
  // with the drag, so it stays within snapping range for the whole gesture:
  // the preview kept resolving back onto it, the ghost flicked between the
  // two places, and the release put the part back where it started.
  const travelling = assemblyMembers(s.project.items, jointsOf(s.project), item.id)
  const snapsByItem = new Map<string, ItemSnapPoint[]>()
  for (const placed of s.project.items) {
    if (travelling.has(placed.id) && placed.id !== item.id) continue
    snapsByItem.set(placed.id, snapsForItem(placed, s.itemSnaps, s.itemRules))
  }
  let best: { source: ItemSnapPoint; target: ReturnType<typeof listMatingTargets>[number]; distance: number } | null = null
  for (const source of snapsForItem(item, s.itemSnaps, s.itemRules)) {
    const sourceConnector = connectorForSnap(sourceDefinition, source)
    if (!sourceConnector) continue
    const sourceWorld = worldSnapPosition(item.id, source.position, s.itemRegistry)
    if (!sourceWorld) continue
    for (const target of listMatingTargets(item.id, source.kind, snapsByItem, {}, s.itemRegistry)) {
      const targetItem = s.project.items.find((placed) => placed.id === target.itemId)
      if (!targetItem) continue
      const targetConnector = connectorForSnap(
        definitionFor(s.assemblyManifest, targetItem.catalogId),
        target.point,
      )
      if (!targetConnector || !connectorsCanMate(sourceConnector, source, targetConnector, target.point)) continue
      const pointDistance = Math.hypot(
        sourceWorld[0] - target.position[0],
        sourceWorld[1] - target.position[1],
        sourceWorld[2] - target.position[2],
      )
      // A part held at the wrong angle has its contact point metres from the
      // seat while the part itself is right next to it. Measuring how far it
      // would have to travel to sit in the seat lets the magnet take it and
      // turn it, instead of asking the user to line it up first.
      const seatedYaw = yawToMate(source.normal, target.point.normal, targetItem.rotation[1])
      const seated = positionForItemSnap(
        source.position,
        seatedYaw ?? group.rotation.y,
        itemHeight(s, item),
        target.position,
      )
      const travelDistance = Math.hypot(
        seated[0] - group.position.x,
        seated[1] - (group.position.y - itemHeight(s, item) / 2),
        seated[2] - group.position.z,
      )
      const distance = Math.min(pointDistance, travelDistance)
      if (distance > CONNECTION_SNAP_RADIUS || (best && distance >= best.distance)) continue
      best = { source, target, distance }
    }
  }
  if (!best) return null
  const targetItem = s.project.items.find((placed) => placed.id === best.target.itemId)!
  const sourceConnector = connectorForSnap(sourceDefinition, best.source)!
  const targetConnector = connectorForSnap(
    definitionFor(s.assemblyManifest, targetItem.catalogId),
    best.target.point,
  )!
  const yaw = yawToMate(best.source.normal, best.target.point.normal, targetItem.rotation[1])
  const rotation: Euler = yaw === null
    ? [group.rotation.x, group.rotation.y, group.rotation.z]
    : [0, yaw, 0]
  const position = positionForItemSnap(
    best.source.position,
    rotation,
    itemHeight(s, item),
    best.target.position,
  )
  const connection: Connection = {
    sourceItemId: item.id,
    sourceConnectorId: sourceConnector.id,
    sourcePointId: best.source.id,
    targetItemId: targetItem.id,
    targetConnectorId: targetConnector.id,
    targetPointId: best.target.point.id,
    resolvedTransform: { position, rotation },
  }
  const { joints, issues } = previewAssemblyPlacement(s, item, { position, rotation }, connection)
  // Magnetic drag requires containment; guided attachment may allow it with a warning.
  const blocking = issues.find((issue) => issue.itemIds.includes(item.id))
  return { position, rotation, connection, joints, valid: !blocking, reason: blocking?.message }
}

/** Commit the exact displayed seat once; a newly locked assembly rolls back instead. */
export function commitConnectionPreview(store: ConfiguratorStore, preview: ConnectionPreview | null): boolean {
  if (!preview?.valid) return false
  const state = store.getState()
  const item = state.project?.items.find((entry) => entry.id === preview.connection.sourceItemId)
  if (!state.project || !item || !assemblyCanMove(state, item.id)) {
    restoreLiveItems(state)
    return true
  }
  const current = jointsOf(state.project)
  const members = assemblyMembers(state.project.items, current, item.id)
  const patches = assemblyPosePatches(state.project.items, members, item, preview)
  const source = patches.find((entry) => entry.id === item.id)!
  source.patch.constraints = item.constraints?.filter((constraint) => constraint.type !== 'snapToAnchor') ?? []
  commitLiveItemPatches(store, patches, dedupeJoints([...jointsSurvivingMove(patches, current), ...preview.joints]))
  return true
}
