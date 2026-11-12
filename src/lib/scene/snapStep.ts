import type { AssemblyView } from '../state/selectors'
import type { ConfiguratorStore } from '../state/store'
import type { PlacedItem, Vec3 } from '../types'
import type { Joint } from '../assembly/graph'
import { assemblyMembers, dedupeJoints, isResolvedJoint, jointsOf, pointUse, withJoints } from '../assembly/graph'
import { connectionsAtPose, connectorForSnap, definitionFor } from '../assembly/manifest'
import { validateConfiguration } from '../assembly/validation'
import { itemHeight } from './assemblyPlacement'
import { snapsForItem } from './mating'
import { rotateVector, worldPoint } from './geometry'
import { restoreLiveItems } from './itemMovement'

/** Move the mounted part along its support rows, leaving the supporting frame fixed. */
export function snapStepPreview(state: AssemblyView, id: string, direction: -1 | 1) {
  const project = state.project
  const isSupport = (catalogId: string) => !!(state.catalog[catalogId]?.snapRepeats?.length || state.catalog[catalogId]?.sideHoleSnaps)
  if (!project || isSupport(project.items.find((item) => item.id === id)?.catalogId ?? '')) return null
  const byId = new Map(project.items.map((item) => [item.id, item]))
  const rowAt = (itemId: string, pointId: string) => {
    const item = byId.get(itemId)
    const point = item && state.itemSnaps[item.catalogId]?.find((entry) => entry.id === pointId)
    if (item && point?.series) {
      const ordered = snapsForItem(item, state.itemSnaps, state.itemRules).filter((entry) => entry.series === point.series).sort((a, b) => a.position[1] - b.position[1])
      return { item, row: { id: point.series, pitch: [0, 1, 0] as Vec3 }, index: ordered.findIndex((entry) => entry.id === pointId), ordered }
    }
    const row = item && state.catalog[item.catalogId]?.snapRepeats?.find((entry) =>
      pointId.startsWith(`${entry.id}-`) && /^\d+$/.test(pointId.slice(entry.id.length + 1)))
    return item && row ? { item, row, ordered: undefined, index: Number(pointId.slice(row.id.length + 1)) } : null
  }
  const current = jointsOf(project)
  const supports = current.filter((joint) => rowAt(joint.sourceItemId, joint.sourcePointId) || rowAt(joint.targetItemId, joint.targetPointId))
  const members = assemblyMembers(project.items, current.filter((joint) => !supports.includes(joint)), id)
  const boundary = current.filter((joint) => members.has(joint.sourceItemId) !== members.has(joint.targetItemId))
  if (!boundary.length) return null
  const rejected = (error: string) => ({ valid: false as const, error, patches: [], joints: current, step: 0 })
  if (state.readOnly || state.walkMode || state.attachment) return rejected('Il componente non è modificabile')
  const moving = project.items.filter((item) => members.has(item.id))
  if (moving.some((item) => item.locked || item.constraints?.some((c) => c.type === 'lockAxis' || c.type === 'snapToAnchor') || isSupport(item.catalogId))) return rejected('Un componente da spostare è bloccato o vincolato')
  let delta: Vec3 | undefined
  const replacements = new Map<Joint, Joint>()
  for (const joint of boundary) {
    if (!isResolvedJoint(joint)) return rejected('Attendi il caricamento degli agganci')
    const sourceFixed = !members.has(joint.sourceItemId)
    const support = rowAt(sourceFixed ? joint.sourceItemId : joint.targetItemId, sourceFixed ? joint.sourcePointId : joint.targetPointId)
    if (!support) return rejected('Gli agganci non consentono lo scorrimento sul fianco')
    const { item, row, index } = support
    const pitch = rotateVector(row.pitch, item.rotation)
    if (Math.abs(pitch[0]) > 1e-6 || Math.abs(pitch[2]) > 1e-6 || Math.abs(pitch[1]) < 1e-6) return rejected('La serie di fori non è verticale')
    const points = snapsForItem(item, state.itemSnaps, state.itemRules)
    const before = support.ordered?.[index] ?? points.find((point) => point.id === `${row.id}-${index}`)
    const next = index + direction * Math.sign(pitch[1])
    const after = support.ordered ? support.ordered[next] : points.find((point) => point.id === `${row.id}-${next}`)
    if (!before || !after) return rejected(direction > 0 ? 'Ultimo foro superiore raggiunto' : 'Ultimo foro inferiore raggiunto')
    const connector = connectorForSnap(definitionFor(state.assemblyManifest, item.catalogId), after)
    if (pointUse(current.filter((entry) => !boundary.includes(entry)), item.id, after.id) >= (connector?.capacity ?? 1)) return rejected('Il foro adiacente è occupato')
    const a = worldPoint(item, before.position, itemHeight(state, item))
    const b = worldPoint(item, after.position, itemHeight(state, item))
    const change = b.map((value, axis) => value - a[axis]) as Vec3
    if (Math.abs(change[0]) > 1e-6 || Math.abs(change[2]) > 1e-6 || change[1] * direction <= 0) return rejected('La serie di fori non è verticale')
    if (delta && change.some((value, axis) => Math.abs(value - delta![axis]) > 1e-6)) return rejected('I fianchi hanno passi diversi')
    delta = change
    replacements.set(joint, { ...joint, [sourceFixed ? 'sourcePointId' : 'targetPointId']: after.id })
  }
  if (!delta) return null
  const patches = moving.map((item) => ({ id: item.id, patch: { position: item.position.map((value, axis) => value + delta![axis]) as Vec3 } }))
  const items = project.items.map((item) => ({ ...item, ...patches.find((entry) => entry.id === item.id)?.patch }))
  const moved = new Map(items.map((item) => [item.id, item]))
  const updated = current.map((joint) => {
    const next = replacements.get(joint) ?? joint
    const source = moved.get(next.sourceItemId) as PlacedItem
    return isResolvedJoint(next) && (members.has(next.sourceItemId) || members.has(next.targetItemId))
      ? { ...next, resolvedTransform: { position: source.position, rotation: source.rotation } } : next
  })
  const joints = dedupeJoints([...updated, ...moving.flatMap((item) => connectionsAtPose(moved.get(item.id)!, moved.get(item.id)!, {
    items, itemSnaps: state.itemSnaps, itemRules: state.itemRules, manifest: state.assemblyManifest, heightOf: (placed) => itemHeight(state, placed),
  }))])
  const issue = validateConfiguration(withJoints(project, items, joints), state.catalog, state.assemblyManifest, {
    itemSnaps: state.itemSnaps, itemRules: state.itemRules, itemSizes: state.itemSizes, enclosureBounds: state.interiorBBox,
  }).find((entry) => entry.level === 'error' && entry.itemIds.some((itemId) => members.has(itemId)))
  return { valid: !issue, error: issue?.message, patches, joints, step: Math.abs(delta[1]) }
}

export function stepItemSnap(store: ConfiguratorStore, id: string, direction: -1 | 1): boolean {
  const result = snapStepPreview(store.getState(), id, direction)
  if (!result?.valid) return false
  store.getState().commitJoints(result.patches, result.joints)
  restoreLiveItems(store.getState())
  store.setState({ interactionNotice: `Spostato di un foro verso ${direction > 0 ? 'l’alto' : 'il basso'}` })
  return true
}
