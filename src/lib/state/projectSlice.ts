import { parseProject } from '../io/serialize'
import { resolvePendingJoints } from '../assembly/resolveJoints'
import { dedupeJoints, jointsOf, pendingJoints, toEditableProject, toPersistedProject, withJoints } from '../assembly/graph'
import type { Joint } from '../assembly/graph'
import type { PlacedItem, ProjectData } from '../types'
import { applyItemPatch, removeProjectItems } from './projectGraph'
import { endAttachment, enclosureChangeReset, historyStepReset, projectChangeReset } from './reset'
import type { GetState, ItemPatches, ProjectCommands, ProjectState, SetState } from './storeTypes'

const HISTORY_LIMIT = 50

function canPatchItem(item: PlacedItem, patch: Partial<PlacedItem>): boolean {
  if (patch.id !== undefined && patch.id !== item.id) throw new Error('L’ID item non può cambiare')
  if (item.locked && !(Object.keys(patch).length === 1 && patch.locked === false)) return false
  return !(item.constraints ?? []).some((constraint) => {
    if (constraint.type !== 'lockAxis' || !constraint.axis) return false
    const index = constraint.axis === 'x' ? 0 : constraint.axis === 'y' ? 1 : 2
    return (patch.position && patch.position[index] !== item.position[index]) || (patch.rotation && patch.rotation[index] !== item.rotation[index])
  })
}

// An empty constraint list and no list at all are the same item.
const canonical = (project: ProjectData) => JSON.stringify(project, (key, value) =>
  key === 'constraints' && Array.isArray(value) && value.length === 0 ? undefined : value)
const sameProject = (a: ProjectData, b: ProjectData) => a === b || canonical(a) === canonical(b)

/** Replace one item's position outside history; unchanged or non-finite input is ignored. */
function withItemPosition(project: ProjectData, id: string, position: [number, number, number], release: boolean): ProjectData | null {
  const item = project.items.find((entry) => entry.id === id)
  if (!item || !position.every(Number.isFinite) || item.position.every((value, index) => Math.abs(value - position[index]) < 1e-6)) return null
  return {
    ...project,
    items: project.items.map((entry) => entry.id !== id ? entry : release
      ? applyItemPatch(entry, { position: [...position] })
      : { ...entry, position: [...position] }),
  }
}

/** Persistent project and its history. The only slice undo/redo walks. */
export function createProjectSlice(set: SetState, get: GetState): ProjectState & ProjectCommands {
  // Validate before publishing anything: observers see the edit, its undo entry
  // and attachment cleanup together, or see no change at all on failure.
  const commitProject = (next: ProjectData, selection?: string | null) => {
    const state = get()
    if (!state.project || state.readOnly) return
    // A gesture that changed nothing (a click on the gizmo, a drop back in
    // place) must not leave an undo step behind.
    if (sameProject(next, state.project)) {
      if (selection !== undefined && selection !== state.selectedId) set({ selectedId: selection })
      return
    }
    const project = resolvePendingJoints(parseProject(next).project, state)!
    set({
      project,
      past: [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: [],
      ...endAttachment(state),
      ...(selection !== undefined ? { selectedId: selection } : {}),
    })
  }

  // Callers that only know resolved joints must not drop the links still pending.
  const keepPending = (project: ProjectData, joints: Joint[]) => dedupeJoints([...joints, ...pendingJoints(project)])

  // Patches move and lock items; only `joints` changes the graph.
  const commitPatches = (patches: ItemPatches, joints?: Joint[]) => {
    const state = get()
    if (!state.project || state.readOnly || (patches.length === 0 && joints === undefined)) return
    const itemsById = new Map(state.project.items.map((item) => [item.id, item]))
    if (patches.some(({ id, patch }) => {
      const item = itemsById.get(id)
      return !item || !canPatchItem(item, patch)
    })) return
    const byId = new Map(patches.map(({ id, patch }) => [id, patch]))
    const items = state.project.items.map((item) => {
      const patch = byId.get(item.id)
      return patch ? applyItemPatch(item, patch) : item
    })
    commitProject(withJoints(state.project, items, joints ?? jointsOf(state.project)))
  }

  const stepHistory = (direction: 'undo' | 'redo') => {
    const state = get()
    const { past, future, project } = state
    if (state.readOnly || !project || (direction === 'undo' ? past.length === 0 : future.length === 0)) return
    const target = direction === 'undo' ? past[past.length - 1] : future[0]
    set({
      ...historyStepReset(state),
      project: resolvePendingJoints(target, state),
      past: direction === 'undo' ? past.slice(0, -1) : [...past, project].slice(-HISTORY_LIMIT),
      future: direction === 'undo' ? [project, ...future].slice(0, HISTORY_LIMIT) : future.slice(1),
    })
  }

  return {
    project: null,
    past: [],
    future: [],

    setProject: (p) => {
      const state = get()
      const project = resolvePendingJoints(toEditableProject(parseProject(p).project), state)!
      const previous = state.project?.enclosure
      const sameAsset = previous?.glbUrl === project.enclosure.glbUrl &&
        (previous?.scale ?? 1) === (project.enclosure.scale ?? 1) &&
        JSON.stringify(previous?.dimensions) === JSON.stringify(project.enclosure.dimensions)
      set({
        ...projectChangeReset(state),
        ...(sameAsset ? {} : enclosureChangeReset),
        project,
        past: [],
        future: [],
      })
    },

    addItem: (item) => {
      const s = get()
      if (!s.project || s.readOnly) return
      if (s.project.items.some((existing) => existing.id === item.id)) throw new Error('ID item duplicato')
      commitProject({ ...s.project, items: [...s.project.items, item] })
    },

    removeItem: (id) => {
      const s = get()
      const item = s.project?.items.find((entry) => entry.id === id)
      if (!s.project || s.readOnly || !item || item.locked) return
      const partnerId = item.constraints?.find((c) => c.type === 'mirrorPair')?.target
      if (s.project.items.find((entry) => entry.id === partnerId)?.locked) return
      const removed = new Set(partnerId ? [id, partnerId] : [id])
      commitProject(removeProjectItems(s.project, removed),
        s.selectedId && removed.has(s.selectedId) ? null : s.selectedId)
    },

    updateItem: (id, patch) => commitPatches([{ id, patch }]),
    updateItems: (patches) => commitPatches(patches),
    commitJoints: (patches, joints) => commitPatches(patches, joints),
    commitAssembly: (patches, connections) => {
      const project = get().project
      if (project) commitPatches(patches, keepPending(project, connections))
    },

    createMirrorPair: (sourceId, twin, distance, joints) => {
      const s = get()
      if (!s.project) return
      const source = s.project.items.find((it) => it.id === sourceId)
      if (!source || source.locked || s.readOnly || source.constraints?.some((constraint) => constraint.type === 'mirrorPair') || s.project.items.some((item) => item.id === twin.id)) return
      if (!Number.isFinite(distance) || distance <= 0) throw new Error('Distanza coppia non valida')
      const link = (target: string) => ({ type: 'mirrorPair' as const, target, distance })
      const withLink = (item: PlacedItem, target: string): PlacedItem => ({
        ...item,
        constraints: [...(item.constraints?.filter((c) => c.type !== 'mirrorPair') ?? []), link(target)],
      })
      const items = [...s.project.items.map((it) => it.id === sourceId ? withLink(it, twin.id) : it), withLink(twin, sourceId)]
      commitProject(withJoints(s.project, items, joints ? keepPending(s.project, joints) : jointsOf(s.project)))
    },

    removeMirrorPair: (id) => {
      const s = get()
      const item = s.project?.items.find((entry) => entry.id === id)
      const partnerId = item?.constraints?.find((c) => c.type === 'mirrorPair')?.target
      const partner = s.project?.items.find((entry) => entry.id === partnerId)
      if (!s.project || s.readOnly || !item || !partner || item.locked || partner.locked) return
      const removeId = partner.mirrored ? partner.id : item.mirrored ? item.id : partner.id
      commitProject(removeProjectItems(s.project, new Set([removeId])),
        s.selectedId === removeId ? null : s.selectedId)
    },

    setConnections: (connections) => set((s) => s.project ? { project: withJoints(s.project, s.project.items, connections) } : {}),

    hydrateItemPosition: (id, position) => set((s) => {
      const project = s.project && withItemPosition(s.project, id, position, false)
      return project ? { project } : s
    }),

    settleItemPosition: (id, position) => set((s) => {
      const project = s.project && !s.readOnly && withItemPosition(s.project, id, position, true)
      return project ? { project } : s
    }),

    exportProject: () => {
      const project = get().project
      return project ? structuredClone(toPersistedProject(project)) : null
    },

    undo: () => stepHistory('undo'),
    redo: () => stepHistory('redo'),
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  }
}
