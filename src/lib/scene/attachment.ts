import type { ConfiguratorStore } from '../state/store'
import type { AssemblyView } from '../state/selectors'
import type { Euler, ItemSnapPoint } from '../types'
import { DEFAULT_SNAP_TOLERANCE, connectorForSnap, connectorsCanMate, definitionFor } from '../assembly/manifest'
import { canMate, kindMatesWithAny, positionForItemSnap, snapsForItem, yawToMate } from './mating'
import { assemblyMembers, jointsOf, pointUse } from '../assembly/graph'
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

/** Why a point is not offered, when it is shown anyway. */
export type AttachmentPointStatus = 'free' | 'occupied' | 'incompatible' | 'bay-not-allowed'

export interface AttachmentPointState {
  point: ItemSnapPoint
  status: AttachmentPointStatus
  /** Default (Italian) explanation of the status. */
  message: string
  /** Height of the point above the cargo floor, in millimetres. */
  heightMm: number | null
}

const POINT_MESSAGES: Record<AttachmentPointStatus, string> = {
  free: 'Libero',
  occupied: 'Occupato',
  incompatible: 'Famiglia di aggancio non compatibile',
  'bay-not-allowed': 'Campata non ammessa per questo componente',
}

/**
 * Every interface of an item, with whether it can take `source` and why not:
 * occupied, incompatible family, or a mirror-pair spacing the source part does
 * not fit. Points without a manifest connector are not interfaces and are left
 * out; positions include the reflection of mirrored halves.
 */
export function attachmentPointStates(state: AssemblyView, itemId: string, source?: { itemId: string; pointId: string }): AttachmentPointState[] {
  const item = state.project?.items.find((entry) => entry.id === itemId)
  if (!item || own(state.assetErrors, itemId) || !state.itemRegistry.has(itemId)) return []
  const definition = definitionFor(state.assemblyManifest, item.catalogId)
  const sourceItem = source ? state.project?.items.find((entry) => entry.id === source.itemId) : undefined
  const sourcePoint = sourceItem ? snapsForItem(sourceItem, state.itemSnaps, state.itemRules).find((point) => point.id === source?.pointId) : undefined
  const sourceDefinition = sourceItem ? definitionFor(state.assemblyManifest, sourceItem.catalogId) : undefined
  const sourceConnector = sourcePoint ? connectorForSnap(sourceDefinition, sourcePoint) : undefined
  const pair = item.constraints?.find((constraint) => constraint.type === 'mirrorPair')
  const bayRefused = !!sourceDefinition?.bays && pair?.distance !== undefined &&
    !sourceDefinition.bays.some((bay) => Math.abs(bay - pair.distance!) <= DEFAULT_SNAP_TOLERANCE)
  const joints = jointsOf(state.project!)
  const floor = state.interiorBBox?.min[1] ?? 0
  const height = itemHeight(state, item)
  const states: AttachmentPointState[] = []
  for (const point of snapsForItem(item, state.itemSnaps, state.itemRules)) {
    // The manifest names the interfaces; without one, the kind table does.
    const connector = connectorForSnap(definition, point)
    if (state.assemblyManifest ? !connector : !kindMatesWithAny(point.kind)) continue
    let status: AttachmentPointStatus = 'free'
    if (pointUse(joints, itemId, point.id) >= (connector?.capacity ?? 1)) status = 'occupied'
    else if (source && (!sourcePoint || (state.assemblyManifest
      ? !sourceConnector || !connector || !connectorsCanMate(sourceConnector, sourcePoint, connector, point)
      : !canMate(sourcePoint.kind, point.kind)))) status = 'incompatible'
    else if (source && bayRefused) status = 'bay-not-allowed'
    const y = worldPoint(item, point.position, height)[1] - floor
    states.push({ point, status, message: POINT_MESSAGES[status], heightMm: Number.isFinite(y) ? Math.round(y * 1000) : null })
  }
  return states
}

/** Available interfaces, including reflected positions for mirrored products. */
export function attachmentPoints(state: AssemblyView, itemId: string, source?: { itemId: string; pointId: string }): ItemSnapPoint[] {
  return attachmentPointStates(state, itemId, source).filter((entry) => entry.status === 'free').map((entry) => entry.point)
}

/** Why another item of the scene is not offered as a destination. */
export interface AttachmentTargetState {
  itemId: string
  status: 'available' | 'same-assembly' | 'no-points' | Exclude<AttachmentPointStatus, 'free'>
  message: string
}

/** Every other item of the scene with whether the chosen source point can go on it. */
export function attachmentTargetStates(state: AssemblyView): AttachmentTargetState[] {
  const interaction = state.attachment
  if (!interaction?.sourcePointId || !state.project) return []
  const members = assemblyMembers(state.project.items, jointsOf(state.project), interaction.sourceItemId)
  const source = { itemId: interaction.sourceItemId, pointId: interaction.sourcePointId }
  return state.project.items.filter((item) => item.id !== interaction.sourceItemId && state.itemRegistry.has(item.id)).map((item) => {
    if (members.has(item.id)) return { itemId: item.id, status: 'same-assembly', message: 'Già nello stesso assieme' }
    const points = attachmentPointStates(state, item.id, source)
    if (points.some((entry) => entry.status === 'free')) return { itemId: item.id, status: 'available', message: 'Disponibile' }
    // The most specific reason the user can act on comes first.
    const reason = (['bay-not-allowed', 'occupied', 'incompatible'] as const).find((status) => points.some((entry) => entry.status === status))
    if (!reason) return { itemId: item.id, status: 'no-points', message: 'Nessun punto di aggancio' }
    return { itemId: item.id, status: reason, message: reason === 'occupied' ? 'Punti compatibili tutti occupati' : POINT_MESSAGES[reason] }
  })
}

export function attachmentTargetIds(state: AssemblyView): Set<string> {
  return new Set(attachmentTargetStates(state).filter((entry) => entry.status === 'available').map((entry) => entry.itemId))
}

/** Pure preview: neither persisted poses nor live Three.js groups are changed. */
export function computeAttachmentPreview(state: AssemblyView, sourceId: string, sourcePointId: string, targetId: string, targetPointId: string) {
  const project = state.project
  const source = project?.items.find((item) => item.id === sourceId)
  const target = project?.items.find((item) => item.id === targetId)
  const rejected = (error: string, reason?: string) => ({ valid: false as const, error, reason, patches: [], joints: [] as Joint[], warning: undefined })
  if (!project || !source || !target || !assemblyCanMove(state, sourceId)) return rejected('Il componente non è modificabile')
  const members = assemblyMembers(project.items, jointsOf(project), sourceId)
  if (members.has(targetId)) return rejected('Il destinatario appartiene già a questo assieme')
  const sourcePoint = attachmentPoints(state, sourceId).find((point) => point.id === sourcePointId)
  const targetPoint = attachmentPoints(state, targetId, { itemId: sourceId, pointId: sourcePointId }).find((point) => point.id === targetPointId)
  if (!sourcePoint) return rejected('Punto del componente non disponibile', 'occupied')
  if (!targetPoint) {
    const blocked = attachmentPointStates(state, targetId, { itemId: sourceId, pointId: sourcePointId }).find((entry) => entry.point.id === targetPointId)
    return rejected(blocked?.message ?? 'Punto non disponibile', blocked?.status)
  }
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
    valid: !blocking, error: blocking?.message, reason: blocking?.reason, patches, joints,
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
