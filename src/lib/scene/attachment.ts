import type { ConfiguratorStore } from '../state/store'
import type { AssemblyView } from '../state/selectors'
import type { Anchor, AnchorOffsetRule, Euler, ItemSnapPoint, Vec3 } from '../types'
import { DEFAULT_SNAP_TOLERANCE, connectorForSnap, connectorsCanMate, definitionFor } from '../assembly/manifest'
import { assemblyPosePatches, canMate, kindMatesWithAny, positionForItemSnap, snapsForItem, yawToMate } from './mating'
import { assemblyMembers, jointsOf, pointUse } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import { worldPoint } from './geometry'
import { containmentStep, itemHeight, previewAssemblyPlacement } from './assemblyPlacement'
import { ANCHOR_AXES, anchorConstraintOf, anchorOffset, anchorOffsetRule, anchorPointIds, anchoredBasePosition, assemblyCanMove, ruleAnchorOffset, withAnchorConstraint } from './itemMovement'
import { selectEffectiveAnchors } from '../state/selectors'
import { own } from '../util/record'

export interface AttachmentInteraction {
  /**
   * `source` picks a point of the item. A base point then goes to `anchor`
   * (an enclosure anchor, then the distance from it); any other to `target`
   * and `point` (another item, then one of its points).
   */
  stage: 'menu' | 'source' | 'target' | 'point' | 'anchor'
  sourceItemId: string
  sourcePointId?: string
  targetItemId?: string
  hoveredItemId?: string
  hoveredPointId?: string
  selectedPointId?: string
  /** Stage `anchor`: the enclosure anchor chosen for the base point. */
  anchorId?: string
  hoveredAnchorId?: string
  /** Stage `anchor`: distance from the chosen anchor being set, metres, scene frame. */
  anchorDistance?: Vec3
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

/** Whether a point is one of the base points its product is seated on the vehicle by. */
export function isAnchorPoint(state: Pick<AssemblyView, 'project' | 'assemblyManifest'>, itemId: string, pointId: string): boolean {
  const item = state.project?.items.find((entry) => entry.id === itemId)
  return !!item && !!anchorPointIds(state, item.catalogId)?.includes(pointId)
}

/**
 * Every interface of an item, with whether it can take `source` and why not:
 * occupied, incompatible family, or a mirror-pair spacing the source part does
 * not fit. Points with neither a manifest connector nor a place among the
 * product's base points are not interfaces and are left out; positions
 * include the reflection of mirrored halves.
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
    if (state.assemblyManifest ? !connector && !definition?.anchorPoints?.includes(point.id) : !kindMatesWithAny(point.kind)) continue
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

/**
 * Pure preview of an item seated by one of its base points on an enclosure
 * anchor, `distance` away from it (default: the product rule's). The assembly
 * comes along as one body and stays inside the enclosure: `offset` is the
 * distance that fits, `limited` says the enclosure took some of it back.
 */
export function computeAnchorPlacement(state: AssemblyView, sourceId: string, pointId: string, anchor: Anchor, distance?: Vec3) {
  const project = state.project
  const source = project?.items.find((item) => item.id === sourceId)
  const rejected = (error: string) => ({ valid: false as const, error, patches: [], offset: undefined, limited: false })
  if (!project || !source || !assemblyCanMove(state, sourceId)) return rejected('Il componente non è modificabile')
  const size = own(state.itemSizes, source.catalogId)
  const snaps = snapsForItem(source, state.itemSnaps, state.itemRules)
  if (!size || !isAnchorPoint(state, sourceId, pointId) || !snaps.some((point) => point.id === pointId)) return rejected('Punto di base non disponibile')
  const wanted = distance ?? ruleAnchorOffset(anchorOffsetRule(state, source.catalogId)) ?? [0, 0, 0]
  const members = assemblyMembers(project.items, jointsOf(project), sourceId)
  const seat = anchoredBasePosition(anchor, { point: pointId, offset: wanted }, source.rotation, snaps, size)
  const step = containmentStep(state, assemblyPosePatches(project.items, members, source, { position: seat, rotation: source.rotation }))
  const position = seat.map((value, axis) => value + (step?.[axis] ?? 0)) as Vec3
  const offset = anchorOffset(wanted.map((value, axis) => Math.round((value + (step?.[axis] ?? 0)) * 1e6) / 1e6) as Vec3)
  const { patches, issues } = previewAssemblyPlacement(state, source, { position, rotation: source.rotation }, null)
  // As for a joint: an assembly larger than the van is reported, not refused.
  const blocking = issues.find((issue) => issue.code !== 'out-of-bounds')
  const entry = patches.find((patch) => patch.id === sourceId)
  if (entry) entry.patch.constraints = withAnchorConstraint(source, { type: 'snapToAnchor', target: anchor.id, point: pointId, ...(offset ? { offset } : {}) })
  return { valid: !blocking, error: blocking?.message, patches, offset, limited: !!step }
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
    // A base point goes on the vehicle: its destinations are the enclosure's anchors.
    const stage = isAnchorPoint(state, interaction.sourceItemId, pointId) ? 'anchor' : 'target'
    state.setAttachment({ ...interaction, stage, sourcePointId: pointId, hoveredPointId: undefined, error: undefined })
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

/** Destination selection previews first, so a touch never commits an unseen pose. */
export function selectAttachmentPoint(store: ConfiguratorStore, pointId: string): void {
  const interaction = store.getState().attachment
  if (interaction?.stage !== 'point') { chooseAttachmentPoint(store, pointId); return }
  store.getState().setAttachment({ ...interaction, selectedPointId: pointId, hoveredPointId: undefined, error: undefined })
}

/**
 * Choose the enclosure anchor the base point goes on. The distance starts
 * from the one this same hold already has, or from the product rule's.
 */
export function chooseAttachmentAnchor(store: ConfiguratorStore, anchorId: string): boolean {
  const state = store.getState()
  const interaction = state.attachment
  const source = state.project?.items.find((item) => item.id === interaction?.sourceItemId)
  if (interaction?.stage !== 'anchor' || !source || !selectEffectiveAnchors(state).some((anchor) => anchor.id === anchorId)) return false
  const held = anchorConstraintOf(source)
  const distance = held?.target === anchorId && held.point === interaction.sourcePointId
    ? held.offset : ruleAnchorOffset(anchorOffsetRule(state, source.catalogId))
  state.setAttachment({ ...interaction, anchorId, anchorDistance: [...(distance ?? [0, 0, 0])], hoveredAnchorId: undefined, error: undefined })
  return true
}

/** Set the distance from the chosen anchor, in metres, on the axes the product rule lists. */
export function setAttachmentAnchorDistance(store: ConfiguratorStore, distance: AnchorOffsetRule): void {
  const state = store.getState()
  const interaction = state.attachment
  const source = state.project?.items.find((item) => item.id === interaction?.sourceItemId)
  const rule = source && anchorOffsetRule(state, source.catalogId)
  if (interaction?.stage !== 'anchor' || !interaction.anchorId || !rule) return
  const next: Vec3 = [...(interaction.anchorDistance ?? [0, 0, 0])]
  ANCHOR_AXES.forEach((axis, index) => {
    if (rule[axis] !== undefined && Number.isFinite(distance[axis])) next[index] = distance[axis]!
  })
  state.setAttachment({ ...interaction, anchorDistance: next, error: undefined })
}

/** A base point that also mates with other products: offer those instead of the anchors. */
export function attachToItemsInstead(store: ConfiguratorStore): void {
  const state = store.getState()
  if (state.attachment?.stage !== 'anchor') return
  state.setAttachment({ ...state.attachment, stage: 'target', anchorId: undefined, anchorDistance: undefined, hoveredAnchorId: undefined, error: undefined })
}

export function confirmAttachment(store: ConfiguratorStore): boolean {
  const state = store.getState()
  const interaction = state.attachment
  if (interaction?.stage === 'anchor') {
    const anchor = selectEffectiveAnchors(state).find((entry) => entry.id === interaction.anchorId)
    if (!anchor || !interaction.sourcePointId) return false
    const result = computeAnchorPlacement(state, interaction.sourceItemId, interaction.sourcePointId, anchor, interaction.anchorDistance)
    if (!result.valid) { state.setAttachment({ ...interaction, error: result.error }); return false }
    state.updateItems(result.patches)
    store.getState().setAttachment(null)
    store.setState({ interactionNotice: result.limited ? 'Ancoraggio completato: distanza ridotta per restare nel vano' : 'Ancoraggio completato' })
    return true
  }
  const pointId = interaction?.selectedPointId
  return !!pointId && chooseAttachmentPoint(store, pointId)
}

export function backAttachment(store: ConfiguratorStore): void {
  const state = store.getState()
  const interaction = state.attachment
  if (!interaction) return
  const cleared = { anchorId: undefined, anchorDistance: undefined, hoveredAnchorId: undefined, error: undefined }
  // From the distances back to the choice of the anchor, then to the point.
  if (interaction.stage === 'anchor' && interaction.anchorId) { state.setAttachment({ ...interaction, ...cleared }); return }
  state.setAttachment({ ...interaction, ...cleared, stage: interaction.stage === 'point' ? 'target' : 'source',
    ...(interaction.stage !== 'point' ? { sourcePointId: undefined } : {}),
    targetItemId: undefined, selectedPointId: undefined, hoveredPointId: undefined, hoveredItemId: undefined })
  if (interaction.stage === 'menu') state.setXrayEnabled(true)
}
