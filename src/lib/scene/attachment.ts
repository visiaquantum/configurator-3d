import type { ConfiguratorStore } from '../state/store'
import type { AssemblyView } from '../state/selectors'
import type { Connection, Euler, ItemSnapPoint } from '../types'
import { connectorForSnap, connectorsCanMate, definitionFor } from '../assembly/manifest'
import { canMate, kindMatesWithAny, positionForItemSnap, snapsForItem, yawToMate } from './mating'
import { assemblyMembers, isResolvedJoint, jointsOf, pointUse } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import { worldPoint } from './geometry'
import { itemHeight, previewAssemblyPlacement } from './assemblyPlacement'
import { assemblyCanMove } from './itemMovement'
import { own } from '../util/record'

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

/** Available interfaces, including reflected positions for mirrored products. */
export function attachmentPoints(state: AssemblyView, itemId: string, source?: { itemId: string; pointId: string }): ItemSnapPoint[] {
  const item = state.project?.items.find((entry) => entry.id === itemId)
  if (!item || own(state.assetErrors, itemId) || !state.itemRegistry.has(itemId)) return []
  const definition = definitionFor(state.assemblyManifest, item.catalogId)
  const sourceItem = source ? state.project?.items.find((entry) => entry.id === source.itemId) : undefined
  const sourcePoint = sourceItem ? snapsForItem(sourceItem, state.itemSnaps, state.itemRules).find((point) => point.id === source?.pointId) : undefined
  const sourceConnector = sourcePoint && sourceItem ? connectorForSnap(definitionFor(state.assemblyManifest, sourceItem.catalogId), sourcePoint) : undefined
  const joints = jointsOf(state.project!)
  return snapsForItem(item, state.itemSnaps, state.itemRules).filter((point) => {
    // The manifest names the interfaces; without one, the kind table does.
    const connector = connectorForSnap(definition, point)
    if (state.assemblyManifest ? !connector : !kindMatesWithAny(point.kind)) return false
    if (pointUse(joints, itemId, point.id) >= (connector?.capacity ?? 1)) return false
    if (!source) return true
    if (!sourcePoint) return false
    return state.assemblyManifest
      ? !!sourceConnector && !!connector && connectorsCanMate(sourceConnector, sourcePoint, connector, point)
      : canMate(sourcePoint.kind, point.kind)
  })
}

export function attachmentTargetIds(state: AssemblyView): Set<string> {
  const interaction = state.attachment
  if (!interaction?.sourcePointId || !state.project) return new Set()
  const members = assemblyMembers(state.project.items, jointsOf(state.project), interaction.sourceItemId)
  return new Set(state.project.items.filter((item) => !members.has(item.id) && state.itemRegistry.has(item.id) && attachmentPoints(state, item.id, {
    itemId: interaction.sourceItemId, pointId: interaction.sourcePointId!,
  }).length > 0).map((item) => item.id))
}

/** Pure preview: neither persisted poses nor live Three.js groups are changed. */
export function computeAttachmentPreview(state: AssemblyView, sourceId: string, sourcePointId: string, targetId: string, targetPointId: string) {
  const project = state.project
  const source = project?.items.find((item) => item.id === sourceId)
  const target = project?.items.find((item) => item.id === targetId)
  const rejected = (error: string) => ({ valid: false as const, error, patches: [], joints: [] as Joint[], connections: [] as Connection[], legacy: false, warning: undefined })
  if (!project || !source || !target || !assemblyCanMove(state, sourceId)) return rejected('Il componente non è modificabile')
  const members = assemblyMembers(project.items, jointsOf(project), sourceId)
  if (members.has(targetId)) return rejected('Il destinatario appartiene già a questo assieme')
  const sourcePoint = attachmentPoints(state, sourceId).find((point) => point.id === sourcePointId)
  const targetPoint = attachmentPoints(state, targetId, { itemId: sourceId, pointId: sourcePointId }).find((point) => point.id === targetPointId)
  if (!sourcePoint || !targetPoint) return rejected('Punto occupato o connettori non compatibili')
  const targetWorld = worldPoint(target, targetPoint.position, itemHeight(state, target))
  const yaw = yawToMate(sourcePoint.normal, targetPoint.normal, target.rotation[1])
  const rotation: Euler = yaw === null ? source.rotation : [source.rotation[0], yaw, source.rotation[2]]
  const position = positionForItemSnap(sourcePoint.position, rotation, itemHeight(state, source), targetWorld)
  const sourceConnector = connectorForSnap(definitionFor(state.assemblyManifest, source.catalogId), sourcePoint)
  const targetConnector = connectorForSnap(definitionFor(state.assemblyManifest, target.catalogId), targetPoint)
  // Without matching connectors (no manifest) the joint stays pending until one resolves it.
  const joint: Joint = {
    sourceItemId: sourceId, sourcePointId, targetItemId: targetId, targetPointId,
    ...(sourceConnector && targetConnector ? {
      sourceConnectorId: sourceConnector.id, targetConnectorId: targetConnector.id, resolvedTransform: { position, rotation },
    } : {}),
  }
  const { patches, joints, issues } = previewAssemblyPlacement(state, source, { position, rotation }, joint)
  // A frame can be built across the van and then rotated into place. Technical
  // containment stays visible in the validation panel and still blocks BOM.
  const blocking = issues.find((issue) => issue.code !== 'out-of-bounds')
  const entry = patches.find((patch) => patch.id === sourceId)
  if (entry) entry.patch.constraints = source.constraints?.filter((constraint) => constraint.type !== 'snapToAnchor') ?? []
  return {
    valid: !blocking, error: blocking?.message, patches, joints,
    /** @deprecated Resolved part of `joints`, for `commitAssembly`. */
    connections: joints.filter(isResolvedJoint),
    /** @deprecated True when the joint has no manifest connectors and stays pending. */
    legacy: !isResolvedJoint(joint),
    warning: issues.find((issue) => issue.code === 'out-of-bounds')?.message,
  }
}

export function beginAttachment(store: ConfiguratorStore, itemId: string, menuPosition?: [number, number]): boolean {
  const state = store.getState()
  if (!assemblyCanMove(state, itemId) || !state.itemRegistry.has(itemId) || (!menuPosition && attachmentPoints(state, itemId).length === 0)) return false
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
  if (!interaction || !assemblyCanMove(state, interaction.sourceItemId)) return false
  if (interaction.stage === 'source') {
    if (!attachmentPoints(state, interaction.sourceItemId).some((point) => point.id === pointId)) return false
    state.setAttachment({ ...interaction, stage: 'target', sourcePointId: pointId, hoveredPointId: undefined, error: undefined })
    return true
  }
  if (interaction.stage !== 'point' || !interaction.sourcePointId || !interaction.targetItemId) return false
  const result = computeAttachmentPreview(state, interaction.sourceItemId, interaction.sourcePointId, interaction.targetItemId, pointId)
  if (!result.valid) { state.setAttachment({ ...interaction, error: result.error, hoveredPointId: pointId }); return false }
  state.commitJoints(result.patches, result.joints)
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
