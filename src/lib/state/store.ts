import { create } from 'zustand'
import type { Camera, Object3D, Scene as ThreeScene, WebGLRenderer } from 'three'
import type {
  Anchor,
  CatalogItem,
  ItemRule,
  ItemSnapPoint,
  PlacedItem,
  ProjectData,
} from '../types'
import { PROJECT_SCHEMA_VERSION } from '../types'

export interface CaptureRefs {
  gl: WebGLRenderer
  scene: ThreeScene
  camera: Camera
}

export type GizmoMode = 'translate' | 'rotate'

export type CameraPreset = 'top' | 'front' | 'side' | 'iso'

export interface EnclosureBBox {
  min: [number, number, number]
  max: [number, number, number]
}

export interface DragClearance {
  itemId: string
  /** Distances (m) from item AABB to enclosure AABB on each axis face. */
  left: number
  right: number
  front: number
  back: number
  bottom: number
  top: number
}

const HISTORY_LIMIT = 50

interface ConfiguratorState {
  project: ProjectData | null
  selectedId: string | null
  /**
   * Catalog of known products, keyed by `id`. Populated from the
   * `catalog` prop on Configurator3D and from imperative `addItem` calls.
   * Used by Item/Inspector to look up glbUrl, label, size by catalogId.
   */
  catalog: Record<string, CatalogItem>
  /** Current gizmo mode for the selected item (TransformControls). */
  gizmoMode: GizmoMode
  /** Anchors extracted at runtime from the enclosure GLB (takes priority over project.enclosure.anchors). */
  runtimeAnchors: Anchor[]
  /**
   * Rules extracted at runtime from product GLBs, keyed by catalogId.
   * Positions/axes are in the item's local frame (set by scene/Item.tsx once
   * the GLB loads). Derived from the GLB, so they survive setProject.
   */
  itemRules: Record<string, ItemRule[]>
  /**
   * Snap points extracted at runtime from product GLBs (`SNAP_*` nodes or
   * extras kind:'snap'), keyed by catalogId, in the item's local frame.
   */
  itemSnaps: Record<string, ItemSnapPoint[]>
  /** Id of the item currently being mouse-dragged. Suspends OrbitControls. */
  draggingItemId: string | null
  /** Refs into the live Three.js renderer (set by SceneCaptureBridge inside Canvas). */
  captureRefs: CaptureRefs | null
  /** Undo/redo stacks of ProjectData snapshots. */
  past: ProjectData[]
  future: ProjectData[]
  /** When true, disables selection, gizmo, drag, and export via keyboard. */
  readOnly: boolean
  /** When true, enclosure renders semi-transparent so the interior is visible. */
  xrayEnabled: boolean
  /** When true, drag positions snap to a discrete X/Z grid. */
  snapToGridEnabled: boolean
  /** Grid step (m) used when `snapToGridEnabled` is true. */
  gridStep: number
  /** One-shot camera preset request. CameraPresetBridge resets to null after applying. */
  cameraPreset: CameraPreset | null
  /** AABB of the loaded enclosure GLB in world units, or null until it loads. */
  enclosureBBox: EnclosureBBox | null
  /** AABB of the inner cargo area (`Body_interior` node) in world units, if available. */
  interiorBBox: EnclosureBBox | null
  /** When true, enclosure doors are animated to the open pose. */
  doorsOpen: boolean
  /** Live clearance for the dragged item, or null when no drag is active. */
  dragClearance: DragClearance | null
  /** Ids of items currently overlapping another item's AABB. */
  overlappingIds: Set<string>
  /** When true, switches to first-person POV inside the enclosure (WASD + mouse-look). */
  walkMode: boolean

  setProject: (p: ProjectData) => void
  setCatalog: (items: CatalogItem[]) => void
  addCatalogItem: (item: CatalogItem) => void
  setGizmoMode: (m: GizmoMode) => void
  setRuntimeAnchors: (anchors: Anchor[]) => void
  setItemRules: (catalogId: string, rules: ItemRule[]) => void
  setItemSnaps: (catalogId: string, snaps: ItemSnapPoint[]) => void
  setDraggingItemId: (id: string | null) => void
  setCaptureRefs: (refs: CaptureRefs | null) => void
  setReadOnly: (v: boolean) => void
  setXrayEnabled: (v: boolean) => void
  setSnapToGridEnabled: (v: boolean) => void
  setGridStep: (v: number) => void
  setCameraPreset: (p: CameraPreset | null) => void
  setEnclosureBBox: (b: EnclosureBBox | null) => void
  setInteriorBBox: (b: EnclosureBBox | null) => void
  setDoorsOpen: (v: boolean) => void
  setDragClearance: (c: DragClearance | null) => void
  setOverlappingIds: (ids: Set<string>) => void
  setWalkMode: (v: boolean) => void
  /** Walk the scene and return all Object3Ds tagged with userData.exportable === true. */
  collectExportRoots: () => Object3D[]
  /** Returns the active anchor set (runtime > project.enclosure.anchors > []). */
  getEffectiveAnchors: () => Anchor[]
  updateItem: (id: string, patch: Partial<PlacedItem>) => void
  /** Patch several items atomically (single undo step). */
  updateItems: (patches: Array<{ id: string; patch: Partial<PlacedItem> }>) => void
  addItem: (item: PlacedItem) => void
  removeItem: (id: string) => void
  /**
   * Add `twin` and link it to `sourceId` with reciprocal mirrorPair
   * constraints at `distance` (single undo step).
   */
  createMirrorPair: (sourceId: string, twin: PlacedItem, distance: number) => void
  /** Unlink a mirror pair, removing the auto-created mirrored twin. */
  removeMirrorPair: (id: string) => void
  select: (id: string | null) => void
  exportProject: () => ProjectData | null

  // Undo / redo
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

export const useConfiguratorStore = create<ConfiguratorState>((set, get) => {
  // Snapshot current project into past, clear future. Call BEFORE mutating.
  const pushHistory = () => {
    const cur = get().project
    if (!cur) return
    set((s) => ({
      past: [...s.past, cur].slice(-HISTORY_LIMIT),
      future: [],
    }))
  }

  return {
    project: null,
    selectedId: null,
    catalog: {},
    gizmoMode: 'translate',
    runtimeAnchors: [],
    itemRules: {},
    itemSnaps: {},
    draggingItemId: null,
    captureRefs: null,
    past: [],
    future: [],
    readOnly: false,
    xrayEnabled: false,
    snapToGridEnabled: false,
    gridStep: 0.05,
    cameraPreset: null,
    enclosureBBox: null,
    interiorBBox: null,
    doorsOpen: false,
    dragClearance: null,
    overlappingIds: new Set<string>(),
    walkMode: false,

    setProject: (p) =>
      set({
        project: { ...p, version: p.version ?? PROJECT_SCHEMA_VERSION },
        past: [],
        future: [],
        runtimeAnchors: [],
        selectedId: null,
        draggingItemId: null,
        enclosureBBox: null,
        interiorBBox: null,
        dragClearance: null,
        overlappingIds: new Set<string>(),
      }),

    setCatalog: (items) =>
      set({ catalog: Object.fromEntries(items.map((it) => [it.id, it])) }),

    addCatalogItem: (item) =>
      set((s) => ({ catalog: { ...s.catalog, [item.id]: item } })),

    setGizmoMode: (m) => set({ gizmoMode: m }),

    setRuntimeAnchors: (anchors) => set({ runtimeAnchors: anchors }),

    setItemRules: (catalogId, rules) =>
      set((s) => ({ itemRules: { ...s.itemRules, [catalogId]: rules } })),

    setItemSnaps: (catalogId, snaps) =>
      set((s) => ({ itemSnaps: { ...s.itemSnaps, [catalogId]: snaps } })),

    setDraggingItemId: (id) => set({ draggingItemId: id }),

    setCaptureRefs: (refs) => set({ captureRefs: refs }),

    setReadOnly: (v) => set({ readOnly: v }),

    setXrayEnabled: (v) => set({ xrayEnabled: v }),
    setSnapToGridEnabled: (v) => set({ snapToGridEnabled: v }),
    setGridStep: (v) => set({ gridStep: v }),
    setCameraPreset: (p) => set({ cameraPreset: p }),
    setEnclosureBBox: (b) => set({ enclosureBBox: b }),
    setInteriorBBox: (b) => set({ interiorBBox: b }),
    setDoorsOpen: (v) => set({ doorsOpen: v }),
    setDragClearance: (c) => set({ dragClearance: c }),
    setOverlappingIds: (ids) => set({ overlappingIds: ids }),
    setWalkMode: (v) =>
      set({
        walkMode: v,
        selectedId: v ? null : get().selectedId,
        draggingItemId: null,
        dragClearance: null,
      }),

    collectExportRoots: () => {
      const refs = get().captureRefs
      if (!refs) return []
      const roots: Object3D[] = []
      refs.scene.traverse((obj) => {
        if (obj.userData?.exportable === true) roots.push(obj)
      })
      return roots
    },

    getEffectiveAnchors: () => {
      const s = get()
      if (s.runtimeAnchors.length > 0) return s.runtimeAnchors
      return s.project?.enclosure.anchors ?? []
    },

    updateItem: (id, patch) => {
      const s = get()
      if (!s.project) return
      pushHistory()
      set({
        project: {
          ...s.project,
          items: s.project.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        },
      })
    },

    updateItems: (patches) => {
      const s = get()
      if (!s.project || patches.length === 0) return
      pushHistory()
      const byId = new Map(patches.map((p) => [p.id, p.patch]))
      set({
        project: {
          ...s.project,
          items: s.project.items.map((it) => {
            const patch = byId.get(it.id)
            return patch ? { ...it, ...patch } : it
          }),
        },
      })
    },

    addItem: (item) => {
      const s = get()
      if (!s.project) return
      pushHistory()
      set({ project: { ...s.project, items: [...s.project.items, item] } })
    },

    removeItem: (id) => {
      const s = get()
      if (!s.project) return
      pushHistory()
      // A mirror pair is a single block: removing either half removes both.
      const item = s.project.items.find((it) => it.id === id)
      const partnerId = item?.constraints?.find((c) => c.type === 'mirrorPair')?.target
      const removed = new Set(partnerId ? [id, partnerId] : [id])
      set({
        project: { ...s.project, items: s.project.items.filter((it) => !removed.has(it.id)) },
        selectedId: s.selectedId && removed.has(s.selectedId) ? null : s.selectedId,
      })
    },

    createMirrorPair: (sourceId, twin, distance) => {
      const s = get()
      if (!s.project) return
      const source = s.project.items.find((it) => it.id === sourceId)
      if (!source) return
      pushHistory()
      const link = (target: string) => ({ type: 'mirrorPair' as const, target, distance })
      set({
        project: {
          ...s.project,
          items: [
            ...s.project.items.map((it) =>
              it.id === sourceId
                ? {
                    ...it,
                    constraints: [
                      ...(it.constraints?.filter((c) => c.type !== 'mirrorPair') ?? []),
                      link(twin.id),
                    ],
                  }
                : it,
            ),
            {
              ...twin,
              constraints: [
                ...(twin.constraints?.filter((c) => c.type !== 'mirrorPair') ?? []),
                link(sourceId),
              ],
            },
          ],
        },
      })
    },

    removeMirrorPair: (id) => {
      const s = get()
      if (!s.project) return
      const item = s.project.items.find((it) => it.id === id)
      const partnerId = item?.constraints?.find((c) => c.type === 'mirrorPair')?.target
      if (!item || !partnerId) return
      const partner = s.project.items.find((it) => it.id === partnerId)
      // Drop the auto-created (mirrored) half, keep the other as a free item.
      const removeId = partner?.mirrored ? partnerId : item.mirrored ? id : partnerId
      pushHistory()
      set({
        project: {
          ...s.project,
          items: s.project.items
            .filter((it) => it.id !== removeId)
            .map((it) =>
              it.id === id || it.id === partnerId
                ? { ...it, constraints: it.constraints?.filter((c) => c.type !== 'mirrorPair') }
                : it,
            ),
        },
        selectedId: s.selectedId === removeId ? null : s.selectedId,
      })
    },

    select: (id) => set({ selectedId: id }),

    exportProject: () => get().project,

    undo: () => {
      const { past, future, project } = get()
      if (past.length === 0 || !project) return
      const prev = past[past.length - 1]
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        selectedId: null,
      })
    },

    redo: () => {
      const { past, future, project } = get()
      if (future.length === 0 || !project) return
      const next = future[0]
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        selectedId: null,
      })
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  }
})
