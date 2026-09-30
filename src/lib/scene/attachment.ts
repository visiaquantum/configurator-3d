import type { ConfiguratorState, ConfiguratorStore } from '../state/store'
import type { Connection, Euler, ItemSnapPoint, PlacedItem } from '../types'
import { connectorForSnap, connectorsCanMate, connectionsAtPose, definitionFor } from '../assembly/manifest'
import { validateConfiguration } from '../assembly/validation'
import { assemblyGroup, assemblyPosePatches, canMate, dedupeJoints, itemSnapConstraintFor, jointsSurvivingMove, positionForItemSnap, snapsForItem, yawToMate } from './mating'
import { worldPoint } from './geometry'
import { reconcileConstraints } from '../state/projectGraph'

export interface AttachmentInteraction {
  stage: 'menu' | 'source' | 'target' | 'point'
  sourceItemId: string
  sourcePointId?: string
  targetItemId?: string
  hoveredItemId?: string
  hoveredPointId?: string
  menuPosition?: [number, number]
  previousXray: boolean
  error?: string
}

export function attachmentCanMove(state: ConfiguratorState, id: string): boolean {
  if (!state.project || state.readOnly || state.walkMode) return false
  const members = assemblyGroup(id, state.project.items, state.project.connections ?? [])
  return state.project.items.some((item) => item.id === id) && !state.project.items.some((item) =>
    members.has(item.id) && (item.locked || item.constraints?.some((constraint) => constraint.type === 'lockAxis')),
  )
}

/** Available interfaces, including reflected positions for mirrored products. */
export function attachmentPoints(state: ConfiguratorState, itemId: string, source?: { itemId: string; pointId: string }): ItemSnapPoint[] {
  const item = state.project?.items.find((entry) => entry.id === itemId)
  if (!item || state.assetErrors[itemId] || !state.itemRegistry.has(itemId)) return []
  const definition = definitionFor(state.assemblyManifest, item.catalogId)
  const sourceItem = source ? state.project?.items.find((entry) => entry.id === source.itemId) : undefined
  const sourcePoint = sourceItem ? snapsForItem(sourceItem, state.itemSnaps, state.itemRules).find((point) => point.id === source?.pointId) : undefined
  const sourceConnector = sourcePoint && sourceItem ? connectorForSnap(definitionFor(state.assemblyManifest, sourceItem.catalogId), sourcePoint) : undefined
  return snapsForItem(item, state.itemSnaps, state.itemRules).filter((point) => {
    if (point.kind === 'origine') return false
    const connector = connectorForSnap(definition, point)
    if (state.assemblyManifest && !connector) return false
    const used = (state.project?.connections ?? []).filter((joint) =>
      (joint.sourceItemId === itemId && joint.sourcePointId === point.id) || (joint.targetItemId === itemId && joint.targetPointId === point.id),
    ).length
    if (used >= (connector?.capacity ?? 1)) return false
    if (!source) return true
    if (!sourcePoint) return false
    return state.assemblyManifest
      ? !!sourceConnector && !!connector && connectorsCanMate(sourceConnector, sourcePoint, connector, point)
      : canMate(sourcePoint.kind, point.kind)
  })
}

export function attachmentTargetIds(state: ConfiguratorState): Set<string> {
  const interaction = state.attachment
  if (!interaction?.sourcePointId || !state.project) return new Set()
  const members = assemblyGroup(interaction.sourceItemId, state.project.items, state.project.connections ?? [])
  return new Set(state.project.items.filter((item) => !members.has(item.id) && state.itemRegistry.has(item.id) && attachmentPoints(state, item.id, {
    itemId: interaction.sourceItemId, pointId: interaction.sourcePointId!,
  }).length > 0).map((item) => item.id))
}

function heightOf(state: ConfiguratorState, item: PlacedItem): number {
  return state.itemSizes[item.catalogId]?.[1] ?? (state.catalog[item.catalogId]?.size?.[1] ?? 0) * (state.catalog[item.catalogId]?.scale ?? 1)
}

/** Pure preview: neither persisted poses nor live Three.js groups are changed. */
export function computeAttachmentPreview(state: ConfiguratorState, sourceId: string, sourcePointId: string, targetId: string, targetPointId: string) {
  const project = state.project
  const source = project?.items.find((item) => item.id === sourceId)
  const target = project?.items.find((item) => item.id === targetId)
  if (!project || !source || !target || !attachmentCanMove(state, sourceId)) return { valid: false as const, error: 'Il componente non è modificabile', patches: [], connections: [] }
  const members = assemblyGroup(sourceId, project.items, project.connections ?? [])
  if (members.has(targetId)) return { valid: false as const, error: 'Il destinatario appartiene già a questo assieme', patches: [], connections: [] }
  const sourcePoint = attachmentPoints(state, sourceId).find((point) => point.id === sourcePointId)
  const targetPoint = attachmentPoints(state, targetId, { itemId: sourceId, pointId: sourcePointId }).find((point) => point.id === targetPointId)
  if (!sourcePoint || !targetPoint) return { valid: false as const, error: 'Punto occupato o connettori non compatibili', patches: [], connections: [] }
  const targetWorld = worldPoint(target, targetPoint.position, heightOf(state, target))
  const yaw = yawToMate(sourcePoint.normal, targetPoint.normal, target.rotation[1])
  const rotation: Euler = yaw === null ? source.rotation : [source.rotation[0], yaw, source.rotation[2]]
  const position = positionForItemSnap(sourcePoint.position, rotation, heightOf(state, source), targetWorld)
  const patches = assemblyPosePatches(project.items, members, source, { position, rotation })
  const byId = new Map(patches.map((entry) => [entry.id, entry.patch]))
  const posedItems = project.items.map((item) => ({ ...item, ...byId.get(item.id) }))
  const sourceConnector = connectorForSnap(definitionFor(state.assemblyManifest, source.catalogId), sourcePoint)
  const targetConnector = connectorForSnap(definitionFor(state.assemblyManifest, target.catalogId), targetPoint)
  const connection: Connection | null = sourceConnector && targetConnector ? {
    sourceItemId: sourceId, sourcePointId, sourceConnectorId: sourceConnector.id,
    targetItemId: targetId, targetPointId, targetConnectorId: targetConnector.id,
    resolvedTransform: { position, rotation },
  } : null
  const kept = jointsSurvivingMove(patches, project.connections ?? [])
  const discovered = connection ? posedItems.filter((item) => members.has(item.id)).flatMap((item) => connectionsAtPose(item, item, {
    items: posedItems, itemSnaps: state.itemSnaps, itemRules: state.itemRules, manifest: state.assemblyManifest,
    heightOf: (placed) => heightOf(state, placed),
  })) : []
  const connections = dedupeJoints([...kept, ...discovered, ...(connection ? [connection] : [])])
  const preview = { ...project, items: reconcileConstraints(posedItems, connections), connections }
  const issues = validateConfiguration(preview, state.catalog, state.assemblyManifest, {
    itemSnaps: state.itemSnaps, itemRules: state.itemRules, itemSizes: state.itemSizes, enclosureBounds: state.interiorBBox,
  }).filter((issue) => issue.level === 'error' && issue.itemIds.some((id) => members.has(id)))
  // A frame can be built across the van and then rotated into place. Technical
  // containment stays visible in the validation panel and still blocks BOM.
  const blocking = issues.find((issue) => issue.code !== 'out-of-bounds')
  if (!connection) {
    const entry = patches.find((patch) => patch.id === sourceId)
    if (entry) entry.patch.constraints = [
      ...(source.constraints?.filter((constraint) => constraint.type !== 'snapToItem' && constraint.type !== 'snapToAnchor') ?? []),
      itemSnapConstraintFor(targetId, sourcePointId, targetPointId),
    ]
  }
  return { valid: !blocking, error: blocking?.message, patches, connections, legacy: !connection, warning: issues.find((issue) => issue.code === 'out-of-bounds')?.message }
}

export function beginAttachment(store: ConfiguratorStore, itemId: string, menuPosition?: [number, number]): boolean {
  const state = store.getState()
  if (!attachmentCanMove(state, itemId) || !state.itemRegistry.has(itemId) || (!menuPosition && attachmentPoints(state, itemId).length === 0)) return false
  state.setAttachment(null)
  const previousXray = store.getState().xrayEnabled
  store.setState({ selectedId: itemId, interactionNotice: null, attachment: {
    stage: menuPosition ? 'menu' : 'source', sourceItemId: itemId, menuPosition, previousXray,
  }, ...(!menuPosition ? { xrayEnabled: true } : {}) })
  return true
}

export function chooseAttachmentPoint(store: ConfiguratorStore, pointId: string): boolean {
  const state = store.getState()
  const interaction = state.attachment
  if (!interaction || !attachmentCanMove(state, interaction.sourceItemId)) return false
  if (interaction.stage === 'source') {
    if (!attachmentPoints(state, interaction.sourceItemId).some((point) => point.id === pointId)) return false
    state.setAttachment({ ...interaction, stage: 'target', sourcePointId: pointId, hoveredPointId: undefined, error: undefined })
    return true
  }
  if (interaction.stage !== 'point' || !interaction.sourcePointId || !interaction.targetItemId) return false
  const result = computeAttachmentPreview(state, interaction.sourceItemId, interaction.sourcePointId, interaction.targetItemId, pointId)
  if (!result.valid) { state.setAttachment({ ...interaction, error: result.error, hoveredPointId: pointId }); return false }
  if (result.legacy) state.updateItems(result.patches)
  else state.commitAssembly(result.patches, result.connections)
  state.setAttachment(null)
  store.setState({ interactionNotice: result.warning ?? 'Aggancio completato' })
  return true
}

export function chooseAttachmentTarget(store: ConfiguratorStore, itemId: string): boolean {
  const state = store.getState()
  if (state.attachment?.stage !== 'target' || !attachmentTargetIds(state).has(itemId)) return false
  state.setAttachment({ ...state.attachment, stage: 'point', targetItemId: itemId, hoveredItemId: undefined, hoveredPointId: undefined, error: undefined })
  return true
}

export function backAttachment(store: ConfiguratorStore): void {
  const state = store.getState()
  const interaction = state.attachment
  if (!interaction) return
  state.setAttachment({ ...interaction, stage: interaction.stage === 'point' ? 'target' : 'source',
    ...(interaction.stage !== 'point' ? { sourcePointId: undefined } : {}),
    targetItemId: undefined, hoveredPointId: undefined, hoveredItemId: undefined, error: undefined })
  if (interaction.stage === 'menu') state.setXrayEnabled(true)
}
