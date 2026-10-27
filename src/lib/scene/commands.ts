import { nanoid } from 'nanoid'
import type { ConfiguratorState, ConfiguratorStore } from '../state/store'
import type { CatalogItem, PlacedItem, Vec3 } from '../types'
import { connectionsAtPose } from '../assembly/manifest'
import { assemblyMembers, dedupeJoints, jointsOf, jointsSurvivingMove } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import { selectCollisionBounds, selectEffectiveAnchors } from '../state/selectors'
import { assemblyPosePatches } from './mating'
import { computePartnerPlacement, MIRROR_PAIR_RULE, mirrorPairConstraint } from './mirrorPair'
import { itemHeight } from './assemblyPlacement'
import { withAnchorConstraint } from './itemMovement'

/**
 * Editing commands shared by the inspector, the imperative handle and the
 * keyboard. Each reads the store, decides, and commits one undo entry; none
 * needs React or a mounted scene.
 */

const ADD_GAP = 0.05

/** Where a newly added product goes: right of the last item, on the floor. */
export function nextItemPosition(state: Pick<ConfiguratorState, 'project' | 'catalog' | 'interiorBBox' | 'enclosureBBox'>, product: CatalogItem): Vec3 {
  const items = state.project?.items ?? []
  const last = items[items.length - 1]
  const lastCat = last ? state.catalog[last.catalogId] : undefined
  const stepSize = (lastCat?.size?.[0] ?? 0.1) * (lastCat?.scale ?? 1) || (product.size?.[0] ?? 0.1) * (product.scale ?? 1)
  const floorY = selectCollisionBounds(state)?.min[1] ?? 0
  return last
    ? [last.position[0] + stepSize + ADD_GAP, Math.max(last.position[1], floorY), last.position[2]]
    : [0, floorY, 0]
}

/** Register `product` if needed and place one instance of it. Returns the new item id. */
export function addItemToScene(store: ConfiguratorStore, product: CatalogItem, opts?: { position?: Vec3; select?: boolean }): string {
  const s = store.getState()
  if (!s.project || s.readOnly) throw new Error('Il progetto non è modificabile')
  const position = opts?.position ?? nextItemPosition(s, product)
  s.addCatalogItem(product)
  const id = nanoid(8)
  store.getState().addItem({ id, catalogId: product.id, position, rotation: [0, 0, 0] })
  if (opts?.select !== false) store.getState().select(id)
  return id
}

/** Seat an item's whole assembly on an enclosure anchor, or release the anchor with `null`. */
export function snapAssemblyToAnchor(store: ConfiguratorStore, id: string, anchorId: string | null): void {
  const state = store.getState()
  const item = state.project?.items.find((entry) => entry.id === id)
  if (!state.project || !item) return
  if (!anchorId) {
    state.updateItem(id, { constraints: withAnchorConstraint(item, null) })
    return
  }
  const anchor = selectEffectiveAnchors(state).find((candidate) => candidate.id === anchorId)
  if (!anchor) return
  const members = assemblyMembers(state.project.items, jointsOf(state.project), id)
  state.updateItems(assemblyPosePatches(state.project.items, members, item, { position: anchor.position, rotation: item.rotation })
    .map((entry) => entry.id === id
      ? { ...entry, patch: { ...entry.patch, constraints: withAnchorConstraint(item, { type: 'snapToAnchor', target: anchor.id }) } }
      : entry))
}

/** Release every joint of one item; it stays where it is. */
export function unjoinItem(store: ConfiguratorStore, id: string): void {
  const state = store.getState()
  if (!state.project) return
  state.commitJoints([], jointsOf(state.project).filter((joint) => joint.sourceItemId !== id && joint.targetItemId !== id))
}

/**
 * The graph once `moved` items take their new poses: joints that straddle the
 * move are broken by it, the rest stand, and what the moved parts touch now
 * is discovered from their new poses.
 */
function jointsAfterMove(state: ConfiguratorState, moved: PlacedItem[]): Joint[] {
  if (!state.project) return []
  const byId = new Map(moved.map((it) => [it.id, it]))
  const context = {
    items: state.project.items.map((it) => byId.get(it.id) ?? it),
    itemSnaps: state.itemSnaps,
    itemRules: state.itemRules,
    itemSizes: state.itemSizes,
    manifest: state.assemblyManifest,
    heightOf: (placed: PlacedItem) => itemHeight(state, placed),
  }
  return dedupeJoints([...jointsSurvivingMove(moved, jointsOf(state.project)), ...moved.flatMap((it) => connectionsAtPose(it, it, context))])
}

/**
 * Set the spacing of `id`'s mirror pair: move the existing twin, or create a
 * mirrored one at that spacing. The twin joins what it lands on.
 */
export function setMirrorPairDistance(store: ConfiguratorStore, id: string, distance: number): void {
  const state = store.getState()
  const item = state.project?.items.find((entry) => entry.id === id)
  const rule = item && state.itemRules[item.catalogId]?.find((r) => r.rule === MIRROR_PAIR_RULE)
  if (!state.project || !item || !rule) return
  const placement = computePartnerPlacement(item, rule, distance)
  const pair = mirrorPairConstraint(item)
  if (!pair?.target) {
    const twin: PlacedItem = { id: nanoid(8), catalogId: item.catalogId, position: placement.position, rotation: placement.rotation, mirrored: placement.mirrored }
    state.createMirrorPair(item.id, twin, distance, jointsAfterMove(state, [twin]))
    return
  }
  const partner = state.project.items.find((it) => it.id === pair.target)
  if (!partner) return
  const setDistance = (it: PlacedItem) => it.constraints?.map((c) => (c.type === 'mirrorPair' ? { ...c, distance } : c))
  const patch = { position: placement.position, rotation: placement.rotation, constraints: setDistance(partner) }
  state.commitJoints(
    [{ id: item.id, patch: { constraints: setDistance(item) } }, { id: partner.id, patch }],
    jointsAfterMove(state, [{ ...partner, ...patch }]),
  )
}
