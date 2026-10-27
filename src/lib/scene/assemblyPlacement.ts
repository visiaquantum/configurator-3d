import type { ConfiguratorState } from '../state/store'
import type { Connection, Euler, PlacedItem, Vec3 } from '../types'
import { connectionsAtPose } from '../assembly/manifest'
import { validateConfiguration } from '../assembly/validation'
import { reconcileConstraints } from '../state/projectGraph'
import { assemblyGroup, assemblyPosePatches, dedupeJoints, jointsSurvivingMove } from './mating'

export type AssemblyPlacementContext = Pick<ConfiguratorState,
  'project' | 'catalog' | 'assemblyManifest' | 'itemSnaps' | 'itemRules' | 'itemSizes' | 'interiorBBox'>

export function itemHeight(state: AssemblyPlacementContext, item: PlacedItem): number {
  return state.itemSizes[item.catalogId]?.[1] ?? (state.catalog[item.catalogId]?.size?.[1] ?? 0) * (state.catalog[item.catalogId]?.scale ?? 1)
}

/** Resolve rigid poses, discover all resulting joints and validate without touching the scene or store. */
export function previewAssemblyPlacement(
  state: AssemblyPlacementContext,
  source: PlacedItem,
  pose: { position: Vec3; rotation: Euler },
  connection: Connection | null,
) {
  const project = state.project!
  const members = assemblyGroup(source.id, project.items, project.connections ?? [])
  const patches = assemblyPosePatches(project.items, members, source, pose)
  const byId = new Map(patches.map((entry) => [entry.id, entry.patch]))
  const items = project.items.map((item) => ({ ...item, ...byId.get(item.id) }))
  const discovered = connection ? items.filter((item) => members.has(item.id)).flatMap((item) => connectionsAtPose(item, item, {
    items, itemSnaps: state.itemSnaps, itemRules: state.itemRules, manifest: state.assemblyManifest,
    heightOf: (placed) => itemHeight(state, placed),
  })) : []
  const connections = dedupeJoints([
    ...jointsSurvivingMove(patches, project.connections ?? []),
    ...discovered,
    ...(connection ? [connection] : []),
  ])
  const preview = { ...project, items: reconcileConstraints(items, connections, project.connections), connections }
  const issues = validateConfiguration(preview, state.catalog, state.assemblyManifest, {
    itemSnaps: state.itemSnaps, itemRules: state.itemRules, itemSizes: state.itemSizes, enclosureBounds: state.interiorBBox,
  }).filter((issue) => issue.level === 'error' && issue.itemIds.some((id) => members.has(id)))
  return { patches, connections, issues }
}
