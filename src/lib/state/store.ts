import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createItemRegistry } from '../scene/itemRegistry'
import type { ItemRegistry } from '../scene/itemRegistry'
import { parseProject } from '../io/serialize'
import { parseCatalog } from '../io/catalog'
import { resolveLegacyProject } from '../io/resolveLegacyProject'
import { applyItemPatch, removeProjectItems, withConnections } from './projectGraph'
import type { Camera, Object3D, Scene as ThreeScene, WebGLRenderer } from 'three'
import type {
  Anchor,
  AssemblyManifest,
  CatalogItem,
  Connection,
  ItemRule,
  ItemSnapPoint,
  PlacedItem,
  ProjectData,
  ConfiguratorTelemetryEvent,
  ValidationIssue,
} from '../types'
import type { NeighborGap } from '../scene/neighborGap'
import type { AttachmentInteraction } from '../scene/attachment'
import type { ProductMetadata } from '../io/productMetadata'

export interface CaptureRefs {
  gl: WebGLRenderer
  scene: ThreeScene
  camera: Camera
}

export type GizmoMode = 'translate' | 'rotate'

export type CameraPreset = 'top' | 'front' | 'side' | 'perspective' | 'iso' | 'iso-front-left' | 'iso-back-right' | 'iso-back-left'
export type CameraProjection = 'perspective' | 'orthographic'

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

function canPatchItem(item: PlacedItem, patch: Partial<PlacedItem>): boolean {
  if (patch.id !== undefined && patch.id !== item.id) throw new Error('L’ID item non può cambiare')
  if (item.locked && !(Object.keys(patch).length === 1 && patch.locked === false)) return false
  return !(item.constraints ?? []).some((constraint) => {
    if (constraint.type !== 'lockAxis' || !constraint.axis) return false
    const index = constraint.axis === 'x' ? 0 : constraint.axis === 'y' ? 1 : 2
    return (patch.position && patch.position[index] !== item.position[index]) || (patch.rotation && patch.rotation[index] !== item.rotation[index])
  })
}

export interface ConfiguratorState {
  attachment: AttachmentInteraction | null
  interactionNotice: string | null
  setAttachment: (interaction: AttachmentInteraction | null) => void
  itemRegistry: ItemRegistry
  itemSizes: Record<string, [number, number, number]>
  assetErrors: Record<string, string>
  assetEpoch: number
  loadingCatalog: boolean
  loadingManifest: boolean
  catalogError: string | null
  manifestError: string | null
  hydrateProduct: (product: CatalogItem, metadata: ProductMetadata) => void
  hydrateItemPosition: (id: string, position: [number, number, number]) => void
  setItemSize: (catalogId: string, size: [number, number, number]) => void
  setAssetError: (id: string, error: string | null) => void
  project: ProjectData | null
  selectedId: string | null
  /**
   * Catalog of known products, keyed by `id`. Populated from the
   * `catalog` prop on Configurator3D and from imperative `addItem` calls.
   * Used by Item/Inspector to look up glbUrl, label, size by catalogId.
   */
  catalog: Record<string, CatalogItem>
  assemblyManifest: AssemblyManifest | null
  validationIssues: ValidationIssue[]
  telemetryListener: ((event: ConfiguratorTelemetryEvent) => void) | null
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
  /** Hide exterior walls facing the orbit camera without changing project geometry. */
  cutawayEnabled: boolean
  /** When true, drag positions snap to a discrete X/Z grid. */
  snapToGridEnabled: boolean
  /** Grid step (m) used when `snapToGridEnabled` is true. */
  gridStep: number
  /** One-shot camera preset request. CameraPresetBridge resets to null after applying. */
  cameraPreset: CameraPreset | null
  /** Isometric presets use an orthographic camera; Walk always uses perspective. */
  cameraProjection: CameraProjection
  /**
   * One-shot "center the orbit on the selected item" request, as a counter so
   * repeated clicks re-fire. SelectedOrbitTarget consumes it; selecting an item
   * does NOT move the camera on its own.
   */
  focusSelectedRequest: number
  /** AABB of the loaded enclosure GLB in world units, or null until it loads. */
  enclosureBBox: EnclosureBBox | null
  /** AABB of the inner cargo area (`Body_interior` node) in world units, if available. */
  interiorBBox: EnclosureBBox | null
  /** When true, enclosure doors are animated to the open pose. */
  doorsOpen: boolean
  /** Live clearance for the dragged item, or null when no drag is active. */
  dragClearance: DragClearance | null
  /**
   * Distance from the selected item to the nearest other product, on the
   * nearest axis only. Maintained by scene/NeighborGapIndicator; null when
   * nothing is selected, nothing is in range, or the two overlap.
   */
  neighborGap: NeighborGap | null
  /** Ids of items currently overlapping another item's AABB. */
  overlappingIds: Set<string>
  /** When true, switches to first-person POV inside the enclosure (WASD + mouse-look). */
  walkMode: boolean

  setProject: (p: ProjectData) => void
  setCatalog: (items: CatalogItem[]) => void
  setAssemblyManifest: (manifest: AssemblyManifest | null) => void
  setValidationIssues: (issues: ValidationIssue[]) => void
  setTelemetryListener: (listener: ((event: ConfiguratorTelemetryEvent) => void) | null) => void
  reportTelemetry: (event: ConfiguratorTelemetryEvent) => void
  setConnections: (connections: Connection[]) => void
  addCatalogItem: (item: CatalogItem) => void
  setGizmoMode: (m: GizmoMode) => void
  setRuntimeAnchors: (anchors: Anchor[]) => void
  setItemRules: (catalogId: string, rules: ItemRule[]) => void
  setItemSnaps: (catalogId: string, snaps: ItemSnapPoint[]) => void
  setDraggingItemId: (id: string | null) => void
  setCaptureRefs: (refs: CaptureRefs | null) => void
  setReadOnly: (v: boolean) => void
  setXrayEnabled: (v: boolean) => void
  setCutawayEnabled: (v: boolean) => void
  setSnapToGridEnabled: (v: boolean) => void
  setGridStep: (v: number) => void
  setCameraPreset: (p: CameraPreset | null) => void
  /** Ask SelectedOrbitTarget to center the orbit on the selected item. */
  requestFocusSelected: () => void
  setEnclosureBBox: (b: EnclosureBBox | null) => void
  setInteriorBBox: (b: EnclosureBBox | null) => void
  setDoorsOpen: (v: boolean) => void
  setDragClearance: (c: DragClearance | null) => void
  setNeighborGap: (g: NeighborGap | null) => void
  setOverlappingIds: (ids: Set<string>) => void
  setWalkMode: (v: boolean) => void
  /** Walk the scene and return all Object3Ds tagged with userData.exportable === true. */
  collectExportRoots: () => Object3D[]
  /** Returns the active anchor set (runtime > project.enclosure.anchors > []). */
  getEffectiveAnchors: () => Anchor[]
  updateItem: (id: string, patch: Partial<PlacedItem>) => void
  /** Patch several items atomically (single undo step). */
  updateItems: (patches: Array<{ id: string; patch: Partial<PlacedItem> }>) => void
  /** Atomically commit item changes and the assembly graph as one undo entry. */
  commitAssembly: (
    patches: Array<{ id: string; patch: Partial<PlacedItem> }>,
    connections: Connection[],
  ) => void
  addItem: (item: PlacedItem) => void
  removeItem: (id: string) => void
  /**
   * Add `twin` and link it to `sourceId` with reciprocal mirrorPair
   * constraints at `distance` (single undo step).
   */
  createMirrorPair: (
    sourceId: string,
    twin: PlacedItem,
    distance: number,
    /** Joints the twin makes where it lands; omit to keep the current ones. */
    connections?: Connection[],
  ) => void
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

export const createConfiguratorStore = () => createStore<ConfiguratorState>((set, get) => {
  // Validate before publishing anything: observers see the edit, its undo entry
  // and attachment cleanup together, or see no change at all on failure.
  const commitProject = (next: ProjectData, selection?: string | null) => {
    const state = get()
    if (!state.project || state.readOnly) return
    const project = resolveLegacyProject(parseProject(next).project, state)!
    set({
      project,
      past: [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: [],
      attachment: null,
      ...(state.attachment && state.attachment.stage !== 'menu' && state.xrayEnabled
        ? { xrayEnabled: state.attachment.previousXray } : {}),
      ...(selection !== undefined ? { selectedId: selection } : {}),
    })
  }

  const commitPatches = (
    patches: Array<{ id: string; patch: Partial<PlacedItem> }>,
    connections?: Connection[],
  ) => {
    const state = get()
    if (!state.project || state.readOnly || (patches.length === 0 && connections === undefined)) return
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
    commitProject(connections === undefined
      ? { ...state.project, items }
      : withConnections(state.project, items, connections))
  }

  return {
    attachment: null,
    interactionNotice: null,
    setAttachment: (attachment) => set((state) => {
      if (attachment && state.readOnly) return {}
      return { attachment, ...(!attachment && state.attachment && state.attachment.stage !== 'menu' && state.xrayEnabled
        ? { xrayEnabled: state.attachment.previousXray } : {}) }
    }),
    itemRegistry: createItemRegistry(),
    itemSizes: {},
    assetErrors: {},
    assetEpoch: 0,
    loadingCatalog: false,
    loadingManifest: false,
    catalogError: null,
    manifestError: null,
    hydrateProduct: (product, metadata) => set((state) => {
      // A suspended/obsolete load must not republish data from an old catalog.
      if (state.catalog[product.id] !== product) return state
      const current = { size: state.itemSizes[product.id], snaps: state.itemSnaps[product.id], rules: state.itemRules[product.id] }
      if (JSON.stringify(current) === JSON.stringify(metadata)) return state
      const owned = structuredClone(metadata)
      const updates = {
        itemSizes: { ...state.itemSizes, [product.id]: owned.size },
        itemSnaps: { ...state.itemSnaps, [product.id]: owned.snaps },
        itemRules: { ...state.itemRules, [product.id]: owned.rules },
      }
      return { ...updates, project: resolveLegacyProject(state.project, { ...state, ...updates }) }
    }),
    hydrateItemPosition: (id, position) => set((s) => {
      const item = s.project?.items.find((entry) => entry.id === id)
      if (!s.project || !item || !position.every(Number.isFinite) || item.position.every((value, index) => Math.abs(value - position[index]) < 1e-6)) return {}
      return { project: { ...s.project, items: s.project.items.map((entry) => entry.id === id ? { ...entry, position: [...position] } : entry) } }
    }),
    setItemSize: (catalogId, size) => set((s) => ({ itemSizes: { ...s.itemSizes, [catalogId]: size } })),
    setAssetError: (id, error) => set((s) => {
      const next = { ...s.assetErrors }
      if (error) next[id] = error
      else delete next[id]
      return { assetErrors: next }
    }),
    project: null,
    selectedId: null,
    catalog: {},
    assemblyManifest: null,
    validationIssues: [],
    telemetryListener: null,
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
    cutawayEnabled: false,
    snapToGridEnabled: false,
    gridStep: 0.05,
    cameraPreset: null,
    cameraProjection: 'perspective',
    focusSelectedRequest: 0,
    enclosureBBox: null,
    interiorBBox: null,
    doorsOpen: false,
    dragClearance: null,
    neighborGap: null,
    overlappingIds: new Set<string>(),
    walkMode: false,

    setProject: (p) => {
      const project = resolveLegacyProject(parseProject(p).project, get())!
      get().setAttachment(null)
      const previous = get().project?.enclosure
      const sameAsset = previous?.glbUrl === project.enclosure.glbUrl &&
        (previous?.scale ?? 1) === (project.enclosure.scale ?? 1) &&
        JSON.stringify(previous?.dimensions) === JSON.stringify(project.enclosure.dimensions)
      set({
        project,
        interactionNotice: null,
        past: [], future: [], selectedId: null, draggingItemId: null,
        dragClearance: null, neighborGap: null, walkMode: false,
        validationIssues: [], overlappingIds: new Set<string>(),
        ...(sameAsset ? {} : { runtimeAnchors: [], enclosureBBox: null, interiorBBox: null, cameraPreset: null, cameraProjection: 'perspective' }),
      })
    },

    setCatalog: (items) => {
      const catalog = Object.fromEntries(parseCatalog(items).map((item) => [item.id, item]))
      const previous = get()
      if (JSON.stringify(previous.catalog) === JSON.stringify(catalog)) return
      get().setAttachment(null)
      const changed = new Set(Object.keys(previous.catalog).filter((id) =>
        JSON.stringify(previous.catalog[id]) !== JSON.stringify(catalog[id]),
      ))
      const keep = <T,>(values: Record<string, T>) => Object.fromEntries(
        Object.entries(values).filter(([id]) => !changed.has(id)),
      )
      set({ catalog, itemRules: keep(previous.itemRules), itemSnaps: keep(previous.itemSnaps),
        itemSizes: keep(previous.itemSizes), assetEpoch: previous.assetEpoch + 1 })
    },

    setAssemblyManifest: (manifest) => { get().setAttachment(null); set((state) => ({ assemblyManifest: manifest, project: resolveLegacyProject(state.project, { ...state, assemblyManifest: manifest }) })) },
    setValidationIssues: (issues) => set({ validationIssues: issues }),
    setTelemetryListener: (listener) => set({ telemetryListener: listener }),
    reportTelemetry: (event) => {
      try { get().telemetryListener?.(event) } catch { /* Host instrumentation must not interrupt editing. */ }
    },
    setConnections: (connections) => set((s) => s.project ? { project: withConnections(s.project, s.project.items, connections) } : {}),

    addCatalogItem: (item) => {
      const current = get().catalog
      get().setCatalog([...Object.values(current).filter((entry) => entry.id !== item.id), item])
    },

    setGizmoMode: (m) => set({ gizmoMode: m }),

    setRuntimeAnchors: (anchors) => set({ runtimeAnchors: anchors }),

    setItemRules: (catalogId, rules) =>
      set((state) => {
        const itemRules = { ...state.itemRules, [catalogId]: rules }
        return { itemRules, project: resolveLegacyProject(state.project, { ...state, itemRules }) }
      }),

    setItemSnaps: (catalogId, snaps) =>
      set((state) => {
        const itemSnaps = { ...state.itemSnaps, [catalogId]: snaps }
        return { itemSnaps, project: resolveLegacyProject(state.project, { ...state, itemSnaps }) }
      }),

    setDraggingItemId: (id) => set({ draggingItemId: id }),

    setCaptureRefs: (refs) => set({ captureRefs: refs }),

    setReadOnly: (v) => { if (v) get().setAttachment(null); set({ readOnly: v }) },

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
    requestFocusSelected: () =>
      set((s) => ({ focusSelectedRequest: s.focusSelectedRequest + 1 })),
    setEnclosureBBox: (b) => set({ enclosureBBox: b }),
    setInteriorBBox: (b) => set({ interiorBBox: b }),
    setDoorsOpen: (v) => set({ doorsOpen: v }),
    setDragClearance: (c) => set({ dragClearance: c }),
    setNeighborGap: (g) => set({ neighborGap: g }),
    setOverlappingIds: (ids) => set({ overlappingIds: ids }),
    setWalkMode: (v) =>
      { get().setAttachment(null); set({
        walkMode: v,
        ...(v ? { cameraProjection: 'perspective', cameraPreset: null } : {}),
        selectedId: v ? null : get().selectedId,
        draggingItemId: null,
        dragClearance: null,
        neighborGap: null,
      }) },

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
      if (s.project?.enclosure.anchors?.length) return s.project.enclosure.anchors
      if (s.runtimeAnchors.length > 0) return s.runtimeAnchors
      return s.project?.enclosure.anchors ?? []
    },

    updateItem: (id, patch) => commitPatches([{ id, patch }]),
    updateItems: (patches) => commitPatches(patches),
    commitAssembly: (patches, connections) => commitPatches(patches, connections),

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

    createMirrorPair: (sourceId, twin, distance, connections) => {
      const s = get()
      if (!s.project) return
      const source = s.project.items.find((it) => it.id === sourceId)
      if (!source || source.locked || s.readOnly || source.constraints?.some((constraint) => constraint.type === 'mirrorPair') || s.project.items.some((item) => item.id === twin.id)) return
      if (!Number.isFinite(distance) || distance <= 0) throw new Error('Distanza coppia non valida')
      const link = (target: string) => ({ type: 'mirrorPair' as const, target, distance })
      const items = [
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
      ]
      commitProject(connections === undefined
        ? { ...s.project, items }
        : withConnections(s.project, items, connections))
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

    select: (id) => set({ selectedId: id }),

    exportProject: () => get().project ? structuredClone(get().project) : null,

    undo: () => {
      const { past, future, project } = get()
      if (get().readOnly || past.length === 0 || !project) return
      get().setAttachment(null)
      const prev = past[past.length - 1]
      set({
        project: resolveLegacyProject(prev, get()),
        interactionNotice: null,
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        selectedId: null,
      })
    },

    redo: () => {
      const { past, future, project } = get()
      if (get().readOnly || future.length === 0 || !project) return
      get().setAttachment(null)
      const next = future[0]
      set({
        project: resolveLegacyProject(next, get()),
        interactionNotice: null,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        selectedId: null,
      })
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  }
})


export type ConfiguratorStore = ReturnType<typeof createConfiguratorStore>
export const ConfiguratorStoreContext = createContext<ConfiguratorStore | null>(null)
const legacyStore = createConfiguratorStore()
export const useConfiguratorStoreApi = (): ConfiguratorStore => useContext(ConfiguratorStoreContext) ?? legacyStore

/** Outside a provider, static methods and selectors use the legacy standalone store. */
function useScopedConfiguratorStore<T>(selector: (state: ConfiguratorState) => T): T {
  return useStore(useConfiguratorStoreApi(), selector)
}

export const useConfiguratorStore = Object.assign(useScopedConfiguratorStore, legacyStore)
