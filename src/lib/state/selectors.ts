import type { Anchor, ProjectData } from '../types'
import { assemblyMembers, jointsOf } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import type { ConfiguratorState } from './storeTypes'

/**
 * Selectors read derived data once per project snapshot. Projects are
 * immutable, so a cache keyed by the snapshot can never go stale and lets
 * every placed item ask the same question without recomputing the graph.
 */
function perProject<T>(compute: (project: ProjectData) => T): (project: ProjectData) => T {
  const cache = new WeakMap<ProjectData, T>()
  return (project) => {
    if (!cache.has(project)) cache.set(project, compute(project))
    return cache.get(project)!
  }
}

const NO_JOINTS: Joint[] = []
const NO_ANCHORS: Anchor[] = []
const NOTHING_FROZEN: ReadonlySet<string> = new Set()

const jointsByProject = perProject(jointsOf)

/** Every joint of the current project, resolved or pending. */
export const selectJoints = (state: Pick<ConfiguratorState, 'project'>): Joint[] =>
  state.project ? jointsByProject(state.project) : NO_JOINTS

/** Items whose assembly holds a locked part: gestures and commands must leave them in place. */
const frozenByProject = perProject((project) => {
  const joints = jointsByProject(project)
  const frozen = new Set<string>()
  for (const item of project.items) {
    if (frozen.has(item.id) || !(item.locked || item.constraints?.some((constraint) => constraint.type === 'lockAxis'))) continue
    assemblyMembers(project.items, joints, item.id).forEach((id) => frozen.add(id))
  }
  return frozen
})

export const selectFrozenIds = (state: Pick<ConfiguratorState, 'project'>): ReadonlySet<string> =>
  state.project ? frozenByProject(state.project) : NOTHING_FROZEN

/** The same editability rule for scene gestures, guided attachment and the inspector. */
export function selectCanMove(state: Pick<ConfiguratorState, 'project' | 'readOnly' | 'walkMode'>, id: string): boolean {
  return !!state.project && !state.readOnly && !state.walkMode &&
    state.project.items.some((item) => item.id === id) && !selectFrozenIds(state).has(id)
}

/** JSON-declared anchors win over the ones extracted from the enclosure GLB. */
export const selectEffectiveAnchors = (state: Pick<ConfiguratorState, 'project' | 'runtimeAnchors'>): Anchor[] =>
  state.project?.enclosure.anchors?.length ? state.project.enclosure.anchors
    : state.runtimeAnchors.length > 0 ? state.runtimeAnchors
      : state.project?.enclosure.anchors ?? NO_ANCHORS

/** Interior cargo bounds when the enclosure declares them, the whole body otherwise. */
export const selectCollisionBounds = (state: Pick<ConfiguratorState, 'interiorBBox' | 'enclosureBBox'>) =>
  state.interiorBBox ?? state.enclosureBBox

export const selectSelectedItem = (state: Pick<ConfiguratorState, 'project' | 'selectedId'>) =>
  state.project?.items.find((item) => item.id === state.selectedId) ?? null

/**
 * The fields assembly logic reads (attachment, previews, inspector). Use with
 * `useShallow` so panels follow project and metadata changes, not every
 * pointer move of a drag.
 */
export const selectAssemblyView = (state: ConfiguratorState) => ({
  project: state.project,
  catalog: state.catalog,
  assemblyManifest: state.assemblyManifest,
  itemSnaps: state.itemSnaps,
  itemRules: state.itemRules,
  itemSizes: state.itemSizes,
  interiorBBox: state.interiorBBox,
  assetErrors: state.assetErrors,
  itemRegistry: state.itemRegistry,
  attachment: state.attachment,
  readOnly: state.readOnly,
  walkMode: state.walkMode,
  xrayEnabled: state.xrayEnabled,
})

export type AssemblyView = ReturnType<typeof selectAssemblyView>
