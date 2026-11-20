import { nanoid } from 'nanoid'
import type { ConfiguratorState, ConfiguratorStore } from '../state/store'
import type { AnchorOffsetRule, CatalogItem, PlacedItem, Vec3 } from '../types'
import { connectionsAtPose } from '../assembly/manifest'
import { assemblyMembers, dedupeJoints, jointsOf, jointsSurvivingMove } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import { selectCanMove, selectCollisionBounds, selectEffectiveAnchors } from '../state/selectors'
import { assemblyPosePatches } from './mating'
import { computePartnerPlacement, MIRROR_PAIR_RULE, mirrorPairConstraint } from './mirrorPair'
import { itemHeight } from './assemblyPlacement'
import { ANCHOR_AXES, anchorConstraintOf, anchorOffsetRule, commitLiveItemPatches, keptInside, ruleAnchorOffset, withAnchorConstraint, withAnchorOffset } from './itemMovement'
import { own } from '../util/record'

/**
 * Editing commands shared by the inspector, the imperative handle and the
 * keyboard. Each reads the store, decides, and commits one undo entry; none
 * needs React or a mounted scene.
 */

/** Centre of the cargo area in X/Z, with the product's base on the floor. */
export function nextItemPosition(state: Pick<ConfiguratorState, 'project' | 'interiorBBox' | 'enclosureBBox'>): Vec3 {
  const bounds = selectCollisionBounds(state)
  const floor = state.project?.enclosure.floor
  const floorY = state.interiorBBox?.min[1] ?? (floor ? floor.y + floor.size[1] / 2 : bounds?.min[1] ?? 0)
  return bounds
    ? [(bounds.min[0] + bounds.max[0]) / 2, floorY, (bounds.min[2] + bounds.max[2]) / 2]
    : [0, floorY, 0]
}

/** Register `product` if needed and place one instance of it. Returns the new item id. */
export function addItemToScene(store: ConfiguratorStore, product: CatalogItem, opts?: { position?: Vec3; select?: boolean }): string {
  const s = store.getState()
  if (!s.project || s.readOnly) throw new Error('Il progetto non è modificabile')
  const position = opts?.position ?? nextItemPosition(s)
  s.addCatalogItem(product)
  const id = nanoid(8)
  store.getState().addItem({ id, catalogId: product.id, position, rotation: [0, 0, 0] })
  if (opts?.select !== false) store.getState().select(id)
  return id
}

/**
 * Seat an item's whole assembly on an enclosure anchor, or release the anchor
 * with `null`. A product with the `anchorOffset` rule is seated at the rule's
 * distance from the anchor.
 */
export function snapAssemblyToAnchor(store: ConfiguratorStore, id: string, anchorId: string | null): void {
  const state = store.getState()
  const item = state.project?.items.find((entry) => entry.id === id)
  if (!state.project || !item || !selectCanMove(state, id)) return
  if (!anchorId) {
    state.updateItem(id, { constraints: withAnchorConstraint(item, null) })
    return
  }
  const anchor = selectEffectiveAnchors(state).find((candidate) => candidate.id === anchorId)
  if (!anchor) return
  const members = assemblyMembers(state.project.items, jointsOf(state.project), id)
  const offset = ruleAnchorOffset(anchorOffsetRule(state, item.catalogId))
  const position = anchor.position.map((value, axis) => value + (offset?.[axis] ?? 0)) as Vec3
  state.updateItems(assemblyPosePatches(state.project.items, members, item, { position, rotation: item.rotation })
    .map((entry) => entry.id === id
      ? { ...entry, patch: { ...entry.patch, constraints: withAnchorConstraint(item, { type: 'snapToAnchor', target: anchor.id, ...(offset ? { offset } : {}) }) } }
      : entry))
}

/**
 * Set the distance of an anchored item from its enclosure anchor, in metres,
 * on the axes its product's `anchorOffset` rule lists; the other axes and
 * non-finite values are left as they are. The whole assembly takes the step
 * as one body and stays inside the enclosure, so the distance committed is
 * the one that fits. One undo entry.
 */
export function setAnchorOffset(store: ConfiguratorStore, id: string, distance: AnchorOffsetRule): void {
  const state = store.getState()
  const item = state.project?.items.find((entry) => entry.id === id)
  const held = item && anchorConstraintOf(item)
  const rule = item && anchorOffsetRule(state, item.catalogId)
  if (!state.project || !item || !held || !rule || !selectCanMove(state, id)) return
  const current = held.offset ?? [0, 0, 0]
  const wanted: Vec3 = [...current]
  ANCHOR_AXES.forEach((axis, index) => {
    if (rule[axis] !== undefined && Number.isFinite(distance[axis])) wanted[index] = distance[axis]!
  })
  if (wanted.every((value, axis) => Math.abs(value - current[axis]) < 1e-9)) return
  const members = assemblyMembers(state.project.items, jointsOf(state.project), id)
  const position = item.position.map((value, axis) => value + wanted[axis] - current[axis]) as Vec3
  const patches = keptInside(state, assemblyPosePatches(state.project.items, members, item, { position, rotation: item.rotation }))
  // What the enclosure took back comes off the distance, to the micron.
  const placed = patches.find((entry) => entry.id === id)!.patch.position!
  const offset = wanted.map((value, axis) => Math.round((value + placed[axis] - position[axis]) * 1e6) / 1e6) as Vec3
  commitLiveItemPatches(store, patches.map((entry) => entry.id === id
    ? { ...entry, patch: { ...entry.patch, constraints: withAnchorConstraint(item, withAnchorOffset(held, offset)) } }
    : entry))
}

/** Release every joint of one item; it stays where it is. */
export function unjoinItem(store: ConfiguratorStore, id: string): void {
  const state = store.getState()
  if (!state.project) return
  state.commitJoints([], jointsOf(state.project).filter((joint) => joint.sourceItemId !== id && joint.targetItemId !== id))
}

/**
 * Lock or unlock an item together with everything joined to it, in one undo
 * entry. A lone part is locked alone; a part of an assembly locks the whole of
 * it, since one locked member already holds the others in place. Unlocking
 * clears every member, so no forgotten lock keeps the assembly frozen. Takes
 * the state, so the keyboard can run it as well as the inspector.
 */
export function setAssemblyLocked(state: ConfiguratorState, id: string, locked: boolean): void {
  if (!state.project || state.readOnly) return
  const members = assemblyMembers(state.project.items, jointsOf(state.project), id)
  const patches = state.project.items
    .filter((item) => members.has(item.id) && (item.locked === true) !== locked)
    .map((item) => ({ id: item.id, patch: { locked } }))
  if (patches.length > 0) state.updateItems(patches)
}

/** Lock state of an item's assembly: `held` by a lock flag, frozen by an axis lock only, or free. */
export function assemblyLock(state: Pick<ConfiguratorState, 'project'>, id: string): 'held' | 'axis' | 'free' {
  if (!state.project) return 'free'
  const members = assemblyMembers(state.project.items, jointsOf(state.project), id)
  const items = state.project.items.filter((item) => members.has(item.id))
  if (items.some((item) => item.locked)) return 'held'
  return items.some((item) => item.constraints?.some((constraint) => constraint.type === 'lockAxis')) ? 'axis' : 'free'
}

/** `L`: lock the selection's assembly, or unlock it when it is held. */
export function toggleAssemblyLock(state: ConfiguratorState, id: string): void {
  setAssemblyLocked(state, id, assemblyLock(state, id) !== 'held')
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
  const rule = item && own(state.itemRules, item.catalogId)?.find((r) => r.rule === MIRROR_PAIR_RULE)
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
