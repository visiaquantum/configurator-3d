import type { ConfiguratorState } from '../state/store'
import type { Euler, PlacedItem, Vec3 } from '../types'
import { connectionsAtPose } from '../assembly/manifest'
import { validateConfiguration } from '../assembly/validation'
import { assemblyMembers, dedupeJoints, isResolvedJoint, jointsOf, jointsSurvivingMove, withJoints } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import { assemblyPosePatches } from './mating'
import { transformedBounds } from './geometry'
import { clampAxisDelta } from './snapping'
import { selectCollisionBounds } from '../state/selectors'
import { own } from '../util/record'

export type AssemblyPlacementContext = Pick<ConfiguratorState,
  'project' | 'catalog' | 'assemblyManifest' | 'itemSnaps' | 'itemRules' | 'itemSizes' | 'interiorBBox'>

export function itemHeight(state: Pick<ConfiguratorState, 'itemSizes' | 'catalog'>, item: PlacedItem): number {
  return own(state.itemSizes, item.catalogId)?.[1] ?? (own(state.catalog, item.catalogId)?.size?.[1] ?? 0) * (own(state.catalog, item.catalogId)?.scale ?? 1)
}

/**
 * The step that brings the patched items, as one body, back inside the
 * enclosure, or null when they already are. Computed from their sizes alone:
 * the counterpart of `clampItemsToBounds` for previews, which must not touch
 * the live scene.
 */
export function containmentStep(
  state: Pick<ConfiguratorState, 'project' | 'itemSizes' | 'interiorBBox' | 'enclosureBBox'>,
  patches: Array<{ id: string; patch: Partial<PlacedItem> }>,
): Vec3 | null {
  const bounds = selectCollisionBounds(state)
  if (!bounds || !state.project) return null
  const byId = new Map(patches.map((entry) => [entry.id, entry.patch]))
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const item of state.project.items) {
    const patch = byId.get(item.id)
    const size = own(state.itemSizes, item.catalogId)
    if (!patch || !size) continue
    const box = transformedBounds({ ...item, ...patch }, size[1], [0, 0, 0], size)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], box.min[axis])
      max[axis] = Math.max(max[axis], box.max[axis])
    }
  }
  if (!min.every(Number.isFinite)) return null
  const step = min.map((value, axis) => clampAxisDelta(value, max[axis], bounds.min[axis], bounds.max[axis])) as Vec3
  return Math.hypot(...step) <= 1e-6 ? null : step
}

/**
 * Resolve rigid poses, discover all resulting joints and validate without
 * touching the scene or store. `joint` is the seat the source is being put
 * in; a resolved one also binds every other point that lands in line.
 */
export function previewAssemblyPlacement(
  state: AssemblyPlacementContext,
  source: PlacedItem,
  pose: { position: Vec3; rotation: Euler },
  joint: Joint | null,
) {
  const project = state.project!
  const current = jointsOf(project)
  const members = assemblyMembers(project.items, current, source.id)
  const patches = assemblyPosePatches(project.items, members, source, pose)
  const byId = new Map(patches.map((entry) => [entry.id, entry.patch]))
  const items = project.items.map((item) => ({ ...item, ...byId.get(item.id) }))
  const discovered = joint && isResolvedJoint(joint) ? items.filter((item) => members.has(item.id)).flatMap((item) => connectionsAtPose(item, item, {
    items, itemSnaps: state.itemSnaps, itemRules: state.itemRules, manifest: state.assemblyManifest,
    heightOf: (placed) => itemHeight(state, placed),
  })) : []
  const joints = dedupeJoints([
    ...jointsSurvivingMove(patches, current),
    ...discovered,
    ...(joint ? [joint] : []),
  ])
  const issues = validateConfiguration(withJoints(project, items, joints), state.catalog, state.assemblyManifest, {
    itemSnaps: state.itemSnaps, itemRules: state.itemRules, itemSizes: state.itemSizes, enclosureBounds: state.interiorBBox,
  }).filter((issue) => issue.level === 'error' && issue.itemIds.some((id) => members.has(id)))
  return { patches, joints, issues }
}
