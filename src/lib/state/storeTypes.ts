import type { StoreApi } from 'zustand/vanilla'
import type { Camera, Object3D, Scene as ThreeScene, WebGLRenderer } from 'three'
import type {
  Anchor,
  AssemblyManifest,
  CatalogItem,
  Connection,
  ConfiguratorTelemetryEvent,
  ItemRule,
  ItemSnapPoint,
  PlacedItem,
  ProjectData,
  ValidationIssue,
} from '../types'
import type { ItemRegistry } from '../scene/itemRegistry'
import type { NeighborGap } from '../scene/neighborGap'
import type { AttachmentInteraction } from '../scene/attachment'
import type { ProductMetadata } from '../io/productMetadata'
import type { Joint } from '../assembly/graph'

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

export type ItemPatches = Array<{ id: string; patch: Partial<PlacedItem> }>

/**
 * Persistent project: what is saved, exported and walked by undo/redo. Held
 * in editing form — each joint once, see `assembly/graph.ts`; use
 * `exportProject()` for the persisted form.
 */
export interface ProjectState {
  project: ProjectData | null
  /** Undo/redo stacks of project snapshots. Nothing else enters history. */
  past: ProjectData[]
  future: ProjectData[]
}

/**
 * Scene resources: loaded technical data and live Three.js handles. Never
 * saved and never part of history; they survive project changes that keep
 * the same assets.
 */
export interface SceneResources {
  /**
   * Catalog of known products, keyed by `id`. Populated from the `catalog`
   * prop on Configurator3D and from imperative `addItem` calls.
   */
  catalog: Record<string, CatalogItem>
  assemblyManifest: AssemblyManifest | null
  loadingCatalog: boolean
  loadingManifest: boolean
  catalogError: string | null
  manifestError: string | null
  /** Hydrated body dimensions in metres, keyed by catalogId. */
  itemSizes: Record<string, [number, number, number]>
  /** Snap points from product GLBs (`SNAP_*` nodes or extras kind:'snap'), keyed by catalogId, item-local. */
  itemSnaps: Record<string, ItemSnapPoint[]>
  /** Rules from product GLBs, keyed by catalogId, item-local. Survive setProject. */
  itemRules: Record<string, ItemRule[]>
  /** Anchors extracted from the enclosure GLB; JSON-declared anchors take priority. */
  runtimeAnchors: Anchor[]
  /** AABB of the loaded enclosure GLB in world units, or null until it loads. */
  enclosureBBox: EnclosureBBox | null
  /** AABB of the inner cargo area (`Body_interior` node) in world units, if available. */
  interiorBBox: EnclosureBBox | null
  /** Load failures keyed by `enclosure`, `product:<catalogId>` or item id. */
  assetErrors: Record<string, string>
  /** Live item groups of this configurator, for snap and overlap math. */
  itemRegistry: ItemRegistry
  /** Refs into the live renderer (set by SceneCaptureBridge inside Canvas). */
  captureRefs: CaptureRefs | null
  telemetryListener: ((event: ConfiguratorTelemetryEvent) => void) | null
}

/** The current interaction and view preferences. Never saved, never in history. */
export interface InteractionState {
  selectedId: string | null
  attachment: AttachmentInteraction | null
  interactionNotice: string | null
  /** Current gizmo mode for the selected item (TransformControls). */
  gizmoMode: GizmoMode
  /** Id of the item currently being mouse-dragged. Suspends OrbitControls. */
  draggingItemId: string | null
  /** Live clearance for the dragged item, or null when no drag is active. */
  dragClearance: DragClearance | null
  /**
   * Distance from the selected item to the nearest other product, on the
   * nearest axis only. Maintained by scene/NeighborGapIndicator; null when
   * nothing is selected, nothing is in range, or the two overlap.
   */
  neighborGap: NeighborGap | null
  /** When true, disables selection, gizmo, drag, and export via keyboard. */
  readOnly: boolean
  /** When true, switches to first-person POV inside the enclosure (WASD + mouse-look). */
  walkMode: boolean
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
   * repeated clicks re-fire. Selecting an item does NOT move the camera.
   */
  focusSelectedRequest: number
  /** When true, enclosure doors are animated to the open pose. */
  doorsOpen: boolean
}

/** Caches of derived data, kept only because recomputing them is costly. */
export interface DerivedState {
  /** Last validation report (see `validationForState`). */
  validationIssues: ValidationIssue[]
  /** Items in a collision or out-of-bounds error of `validationIssues`. */
  overlappingIds: Set<string>
}

export interface ProjectCommands {
  /** Replace the project: resets history, interaction and project caches. */
  setProject: (p: ProjectData) => void
  addItem: (item: PlacedItem) => void
  removeItem: (id: string) => void
  updateItem: (id: string, patch: Partial<PlacedItem>) => void
  /** Patch several items atomically (single undo step). */
  updateItems: (patches: ItemPatches) => void
  /**
   * Atomically commit item changes and the whole assembly graph as one undo
   * entry. `joints` replaces every joint, resolved or pending.
   */
  commitJoints: (patches: ItemPatches, joints: Joint[]) => void
  /**
   * Atomically commit item changes and the resolved joints as one undo entry.
   * Pending links (`snapToItem` not yet confirmed by a manifest) stay unless a
   * connection between the same points supersedes them.
   */
  commitAssembly: (patches: ItemPatches, connections: Connection[]) => void
  /**
   * Add `twin` and link it to `sourceId` with reciprocal mirrorPair
   * constraints at `distance` (single undo step).
   */
  createMirrorPair: (
    sourceId: string,
    twin: PlacedItem,
    distance: number,
    /** Joints once the twin lands; pending links stay. Omit to keep the current graph. */
    joints?: Joint[],
  ) => void
  /** Unlink a mirror pair, removing the auto-created mirrored twin. */
  removeMirrorPair: (id: string) => void
  /** Record the position an enclosure anchor resolves to. Derived: no undo entry. */
  hydrateItemPosition: (id: string, position: [number, number, number]) => void
  /**
   * Put a free item back inside the enclosure once bounds are known. A
   * correction of loaded or just-edited data, so it adds no undo entry.
   */
  settleItemPosition: (id: string, position: [number, number, number]) => void
  /** The project in its persisted form (with the legacy `snapToItem` view). */
  exportProject: () => ProjectData | null
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

export interface ResourceActions {
  setCatalog: (items: CatalogItem[]) => void
  addCatalogItem: (item: CatalogItem) => void
  setAssemblyManifest: (manifest: AssemblyManifest | null) => void
  /** Publish size, snaps and rules of one product together. */
  hydrateProduct: (product: CatalogItem, metadata: ProductMetadata) => void
  setItemSize: (catalogId: string, size: [number, number, number]) => void
  setItemRules: (catalogId: string, rules: ItemRule[]) => void
  setItemSnaps: (catalogId: string, snaps: ItemSnapPoint[]) => void
  setAssetError: (id: string, error: string | null) => void
  setRuntimeAnchors: (anchors: Anchor[]) => void
  setEnclosureBBox: (b: EnclosureBBox | null) => void
  setInteriorBBox: (b: EnclosureBBox | null) => void
  setCaptureRefs: (refs: CaptureRefs | null) => void
  setTelemetryListener: (listener: ((event: ConfiguratorTelemetryEvent) => void) | null) => void
  reportTelemetry: (event: ConfiguratorTelemetryEvent) => void
  /** Walk the scene and return all Object3Ds tagged with userData.exportable === true. */
  collectExportRoots: () => Object3D[]
  /** Returns the active anchor set (project.enclosure.anchors > runtime > []). */
  getEffectiveAnchors: () => Anchor[]
}

export interface InteractionActions {
  select: (id: string | null) => void
  setAttachment: (interaction: AttachmentInteraction | null) => void
  setGizmoMode: (m: GizmoMode) => void
  setDraggingItemId: (id: string | null) => void
  setDragClearance: (c: DragClearance | null) => void
  setNeighborGap: (g: NeighborGap | null) => void
  setReadOnly: (v: boolean) => void
  setWalkMode: (v: boolean) => void
  setXrayEnabled: (v: boolean) => void
  setCutawayEnabled: (v: boolean) => void
  setSnapToGridEnabled: (v: boolean) => void
  setGridStep: (v: number) => void
  setCameraPreset: (p: CameraPreset | null) => void
  /** Ask SelectedOrbitTarget to center the orbit on the selected item. */
  requestFocusSelected: () => void
  setDoorsOpen: (v: boolean) => void
  setValidationIssues: (issues: ValidationIssue[]) => void
  setOverlappingIds: (ids: Set<string>) => void
}

export type ConfiguratorState = ProjectState & SceneResources & InteractionState & DerivedState &
  ProjectCommands & ResourceActions & InteractionActions

export type SetState = StoreApi<ConfiguratorState>['setState']
export type GetState = StoreApi<ConfiguratorState>['getState']
