import type { ValidationIssue } from '../types'
import { endAttachment, gestureReset, readOnlyReset } from './reset'
import type { DerivedState, GetState, InteractionActions, InteractionState, SetState } from './storeTypes'

/** Items a blocking collision or containment error points at; drives the red tint. */
function collisionIds(issues: ValidationIssue[]): Set<string> {
  const ids = new Set<string>()
  for (const issue of issues) {
    if (issue.level === 'error' && (issue.code === 'collision' || issue.code === 'out-of-bounds')) issue.itemIds.forEach((id) => ids.add(id))
  }
  return ids
}

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id))

/** The current gesture, view preferences and the caches derived from validation. */
export function createInteractionSlice(set: SetState, get: GetState): InteractionState & DerivedState & InteractionActions {
  return {
    selectedId: null,
    attachment: null,
    interactionNotice: null,
    gizmoMode: 'translate',
    draggingItemId: null,
    dragClearance: null,
    neighborGap: null,
    readOnly: false,
    walkMode: false,
    xrayEnabled: false,
    cutawayEnabled: false,
    snapToGridEnabled: false,
    gridStep: 0.05,
    cameraPreset: null,
    cameraProjection: 'perspective',
    focusSelectedRequest: 0,
    doorsOpen: false,
    validationIssues: [],
    overlappingIds: new Set<string>(),

    select: (id) => set({ selectedId: id }),

    setAttachment: (attachment) => set((state) => {
      if (attachment) return state.readOnly ? {} : { attachment }
      return endAttachment(state)
    }),

    setGizmoMode: (m) => set({ gizmoMode: m }),
    setDraggingItemId: (id) => set({ draggingItemId: id }),
    setDragClearance: (c) => set({ dragClearance: c }),
    setNeighborGap: (g) => set({ neighborGap: g }),

    setReadOnly: (v) => set((state) => v ? { ...readOnlyReset(state), readOnly: true } : { readOnly: false }),

    setWalkMode: (v) => set((state) => ({
      ...endAttachment(state),
      ...gestureReset,
      walkMode: v,
      ...(v ? { cameraProjection: 'perspective', cameraPreset: null, selectedId: null } : {}),
    })),

    setXrayEnabled: (v) => set({ xrayEnabled: v }),
    setCutawayEnabled: (v) => set({ cutawayEnabled: v }),
    setSnapToGridEnabled: (v) => set({ snapToGridEnabled: v }),
    setGridStep: (v) => { if (Number.isFinite(v) && v > 0) set({ gridStep: v }) },
    setCameraPreset: (p) => set({
      cameraPreset: p,
      ...(p === null ? {} : {
        cameraProjection: p === 'iso' || p.startsWith('iso-') ? 'orthographic' : 'perspective',
        walkMode: false,
      }),
    }),
    requestFocusSelected: () => set((s) => ({ focusSelectedRequest: s.focusSelectedRequest + 1 })),
    setDoorsOpen: (v) => set({ doorsOpen: v }),

    // The tint is derived from the report in the same notification, not by a component effect.
    setValidationIssues: (issues) => {
      const overlapping = collisionIds(issues)
      set({ validationIssues: issues, ...(sameIds(overlapping, get().overlappingIds) ? {} : { overlappingIds: overlapping }) })
    },
    setOverlappingIds: (ids) => set({ overlappingIds: ids }),
  }
}
