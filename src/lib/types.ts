export type Vec3 = [number, number, number]
export type Euler = [number, number, number]

export interface Anchor {
  id: string
  position: Vec3
  normal?: Vec3
}

/** A door the "Apri" toggle animates: a hinge turn or a slide, in the node's own units. */
export type EnclosureDoor =
  | { kind: 'rotate'; axis: 'y' | 'z'; openAngle: number }
  | { kind: 'slide'; axis: 'x' | 'y' | 'z'; distance: number }

export interface EnclosureData {
  glbUrl: string
  /** Inner cargo volume in metres, centred on X/Z with its base at Y = 0. */
  dimensions?: Vec3
  /** Snap anchors in metres; they take priority over the anchors found in the GLB. */
  anchors?: Anchor[]
  /** Uniform scale applied to the loaded GLB. Use when the model was exported
   * at a non-meter scale (e.g. 0.1× → scale: 10). Default 1. */
  scale?: number
  /**
   * A cargo floor drawn inside the model, in metres: a box of `size` centred
   * on X/Z at height `y`. Without `dimensions` or a `Body_interior` node it
   * also bounds the cargo area, from its top up to the top of the model.
   */
  floor?: { size: Vec3; y: number; color?: string }
  /** Doors the "Apri" toggle animates, keyed by GLB node name. */
  doors?: Record<string, EnclosureDoor>
}

/** Product-level override for which perforated faces become snap points. */
export interface AutoSnapGridOptions {
  /** Scan a single external face: the side of its dominant axis the vector points to. */
  normal?: Vec3
  /** Scan only the external faces whose outward normals are listed. Wins over `normal`. */
  normals?: Vec3[]
  /** `primary` scans only the two faces of the model's thinnest axis. Default: all six. */
  faces?: 'primary'
  /** Limit detection to mesh names containing one of these strings. */
  meshNameIncludes?: string[]
  minHoleSize?: number
  maxHoleSize?: number
  planeTolerance?: number
  vertexTolerance?: number
}

export interface CatalogItem {
  id: string
  label: string
  glbUrl: string
  size?: Vec3
  /** Uniform scale applied to the loaded GLB and to `size` for collider math.
   * Same purpose as EnclosureData.scale. Default 1. */
  scale?: number
  /**
   * Turn on hole detection (`auto-snap-grid`) for this product even though its
   * GLB declares no rule. Use when the CAD export can carry neither glTF
   * extras nor a `RULE_AUTOSNAPGRID` node. Default false.
   */
  autoSnapGrid?: boolean | AutoSnapGridOptions
  /**
   * Product-local snap points declared by the catalog. Use this for known
   * mechanical interfaces whose authoritative locations must not depend on
   * runtime geometry inference.
   */
  snapPoints?: ItemSnapPoint[]
}

/** The item rests on an enclosure anchor. */
export interface SnapToAnchorConstraint {
  type: 'snapToAnchor'
  /** Enclosure anchor id. */
  target: string
  /**
   * Which bottom corner of the item collider sits on the anchor (index 0-3:
   * -x-z, +x-z, -x+z, +x+z). Omitted = item center.
   */
  corner?: number
  /** Id of this item's snap point that sits on the anchor. Wins over `corner`. */
  point?: string
}

/**
 * A joint to another item's snap point in the legacy, connector-free form: a
 * pending joint in memory, or the compatibility view of a resolved one in
 * saved files (see assembly/graph.ts).
 */
export interface SnapToItemConstraint {
  type: 'snapToItem'
  /** The other item's id. */
  target: string
  /** This item's snap point. */
  point: string
  /** The other item's snap point that `point` is joined to. */
  targetPoint: string
}

/** Gestures leave the item (and its assembly) in place; commands keep this axis unchanged. */
export interface LockAxisConstraint {
  type: 'lockAxis'
  axis: 'x' | 'y' | 'z'
}

/** Reciprocal link between the two halves of a mirror pair. */
export interface MirrorPairConstraint {
  type: 'mirrorPair'
  /** The other half's item id. */
  target: string
  /** Distance (m) between the two rule reference points. */
  distance?: number
}

export type ItemConstraint = SnapToAnchorConstraint | SnapToItemConstraint | LockAxisConstraint | MirrorPairConstraint

/**
 * A snap point declared inside a product GLB (`SNAP_*` node or extras
 * `kind: "snap"`), in the item's local frame (origin = collider center).
 */
export interface ItemSnapPoint {
  /** Unique within the product. Bare `kind`, or `kind-N` when kind repeats. */
  id: string
  /** Optional human-readable name shown during visual attachment. */
  label?: string
  /** Mating family (`terra`, `frontale`, `laterale`, `foro`, ...). Decides
   * what this point may be joined to — see scene/mating.ts. */
  kind: string
  position: Vec3
  /** Outward normal of the face the point sits on, in the item's local frame. */
  normal?: Vec3
}

/** A simplified local-space collider used by the assembly validator. */
export interface ColliderBox {
  id: string
  center: Vec3
  size: Vec3
}

/**
 * A permitted void volume around a connector. Its centre is relative to that
 * connector's resolved snap point, not to the product origin.
 */
export interface ConnectorClearanceBox {
  id: string
  center: Vec3
  size: Vec3
}

/** A non-geometric part introduced by an assembly connection, e.g. fasteners. */
export interface BomComponent {
  code: string
  label: string
  quantity: number
}

/** Semantic connector declared by the external assembly manifest. */
export interface ConnectorDefinition {
  id: string
  snapId?: string
  snapKind?: string
  compatibleWith?: string[]
  capacity?: number
  /**
   * Maximum permitted collision along the insertion axis, in product units:
   * multiplied by `catalog.scale`, like colliders and clearance boxes.
   */
  insertionDepth?: number
  /** Insertion direction in this product's own frame; defaults to the snap point's normal. */
  insertionAxis?: Vec3
  /** Exact interpenetration areas permitted for a joint using this connector. */
  clearance?: ConnectorClearanceBox[]
  /** Max source/target snap distance once the joint is committed. Default 2 mm. */
  snapTolerance?: number
  /**
   * Parts added to the BOM for each joint this connector takes part in,
   * whichever end of the joint it is. Declare shared hardware on one side only.
   */
  bomComponents?: BomComponent[]
}

export interface ProductAssemblyDefinition {
  catalogId: string
  connectors: ConnectorDefinition[]
  colliders?: ColliderBox[]
  bom?: { code?: string; label?: string }
}

/** Versioned source of truth for product connection and collider semantics. */
export interface AssemblyManifest {
  version: number
  products: ProductAssemblyDefinition[]
}

/** A persisted, resolved product-to-product joint. */
export interface Connection {
  sourceItemId: string
  sourceConnectorId: string
  sourcePointId: string
  targetItemId: string
  targetConnectorId: string
  targetPointId: string
  /** Transform resolved for the source when this joint was committed. */
  resolvedTransform?: { position: Vec3; rotation: Euler }
}

export interface ValidationIssue {
  level: 'error' | 'warning'
  /** Broad category, stable across versions. */
  code: 'collision' | 'connection' | 'connector-capacity' | 'unknown-product' | 'out-of-bounds' | 'incomplete-data'
  /** The specific finding, stable across versions: translate from this, not from `message`. */
  reason: import('./assembly/messages').ValidationReason
  /** Default (Italian) text. */
  message: string
  /** Values the message interpolates, for hosts that format their own text. */
  params?: import('./assembly/messages').ValidationParams
  itemIds: string[]
}

export interface ValidationContext {
  /** Hydrated body dimensions in metres, after catalog scale. */
  itemSizes?: Record<string, Vec3>
  itemSnaps?: Record<string, ItemSnapPoint[]>
  itemRules?: Record<string, ItemRule[]>
  enclosureBounds?: { min: Vec3; max: Vec3 } | null
}

/** Opt-in local instrumentation; the host decides whether and where to send it. */
export interface ConfiguratorTelemetryEvent {
  type: 'catalog-load' | 'manifest-load' | 'asset-load' | 'frame-time' | 'export' | 'validation'
  durationMs?: number
  outcome?: 'success' | 'error'
  detail?: Record<string, string | number | boolean>
}

/**
 * A parametric behaviour declared inside a product GLB via glTF extras
 * (`kind: "rule"`). The GLB carries only the rule id and its parameters;
 * the logic lives in the configurator (see scene/mirrorPair.ts).
 */
export interface ItemRule {
  /** Rule id, e.g. 'mirror-pair'. */
  rule: string
  /** Rule reference point in the item's local frame (origin = collider center). */
  position: Vec3
  /** Unit direction of the rule axis in the item's local frame. */
  axis: Vec3
  /** Free-form parameters from the GLB extras (schema depends on the rule). */
  params: Record<string, unknown>
}

export interface PlacedItem {
  id: string
  catalogId: string
  position: Vec3
  rotation: Euler
  locked?: boolean
  /** Rendered mirrored across the plane perpendicular to the mirror-pair
   * rule axis (X or Z flip, derived from the GLB rule). */
  mirrored?: boolean
  constraints?: ItemConstraint[]
}

export interface ProjectMetadata {
  name?: string
  customer?: string
  createdAt?: string
  updatedAt?: string
  [k: string]: unknown
}

export interface ProjectData {
  id: string
  version: number
  enclosure: EnclosureData
  items: PlacedItem[]
  connections?: Connection[]
  metadata?: ProjectMetadata
}

export type ConfiguratorTheme = 'light' | 'dark'

export interface Configurator3DProps {
  /** Palette for the built-in panels and scene background. Default: light. */
  theme?: ConfiguratorTheme
  /** Optional store for host UI. Each configurator owns an isolated store by default. */
  store?: import('./state/store').ConfiguratorStore
  /** Optional HDR URL. Defaults to local procedural reflections; null disables reflections. */
  environmentUrl?: string | null
  /** Optional ref to the imperative handle (addItem, exports, undo/redo, ...). */
  ref?: React.Ref<ConfiguratorHandle>
  /**
   * The enclosure ("contenitore", e.g. truck body, cabinet). Required.
   * Either a URL string to a GLB (shorthand) or a full EnclosureData object
   * with optional pre-declared anchors and dimensions.
   * The component resets when this prop's reference changes — memoize on the
   * host side to avoid losing in-progress edits.
   */
  enclosure: string | EnclosureData
  /** Items already placed at mount. Defaults to an empty scene. */
  initialItems?: PlacedItem[]
  /** Stable identifier used for export filenames. Auto-generated if omitted. */
  projectId?: string
  /** Free-form project metadata (customer, name, custom fields). */
  metadata?: ProjectMetadata
  /**
   * Optional bootstrap catalog. Needed when `initialItems` references
   * products the configurator must know about up front; otherwise the host
   * drives additions through the imperative `addItem` ref.
   *
   * Accepts an inline array, or a URL string pointing to a JSON file
   * (bare CatalogItem[] or wrapped { version, items, metadata? }).
   */
  catalog?: CatalogItem[] | string
  /** Versioned connector and collider definitions, inline or fetched as JSON. */
  assemblyManifest?: AssemblyManifest | string
  onChange?: (project: ProjectData) => void
  onSave?: (project: ProjectData) => void
  /** Fires once a remote catalog URL has been loaded and validated. */
  onCatalogLoaded?: (items: CatalogItem[]) => void
  /** Fires if a remote catalog URL fails to load or validate. */
  onCatalogError?: (error: Error) => void
  onValidationChange?: (issues: ValidationIssue[]) => void
  /** Optional local instrumentation callback. The library performs no network I/O. */
  onTelemetry?: (event: ConfiguratorTelemetryEvent) => void
  /** Show the bottom-left inspector for the selected item. Default: true. */
  showInspector?: boolean
  /** Show the top-right toolbar with Save / PNG / GLB / PDF buttons. Default: true. */
  showToolbar?: boolean
  /** Show the top-center hints bar (gizmo mode + undo/redo counters). Default: true. */
  showHints?: boolean
  readOnly?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * Imperative API exposed by Configurator3D via ref. The host page uses it to
 * drive the scene from its own UI (catalog list, custom export buttons, etc.).
 */
export interface ConfiguratorHandle {
  /**
   * Place a catalog product into the scene. If the product id is unknown to
   * the configurator, it is registered first so the item can be rendered.
   * Auto-positions to the right of the last item unless `opts.position` is
   * given. Returns the new placed-item id.
   */
  addItem(product: CatalogItem, opts?: { position?: Vec3; select?: boolean }): string
  removeItem(id: string): void
  selectItem(id: string | null): void
  getProject(): ProjectData | null
  getValidation(): ValidationIssue[]
  setProject(p: ProjectData): void
  undo(): void
  redo(): void
  /** PNG snapshot of the current scene as a Blob. */
  exportPNG(): Promise<Blob>
  /** Binary glTF of the enclosure + placed items as a Blob. */
  exportGLB(): Promise<Blob>
  /** A4 PDF with image + component list as a Blob. */
  exportPDF(): Promise<Blob>
}

export const PROJECT_SCHEMA_VERSION = 1
