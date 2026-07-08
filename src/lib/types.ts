export type Vec3 = [number, number, number]
export type Euler = [number, number, number]

export interface Anchor {
  id: string
  position: Vec3
  normal?: Vec3
}

export interface EnclosureData {
  glbUrl: string
  dimensions?: Vec3
  anchors?: Anchor[]
  /** Uniform scale applied to the loaded GLB. Use when the model was exported
   * at a non-meter scale (e.g. 0.1× → scale: 10). Default 1. */
  scale?: number
}

export interface CatalogItem {
  id: string
  label: string
  glbUrl: string
  size?: Vec3
  /** Uniform scale applied to the loaded GLB and to `size` for collider math.
   * Same purpose as EnclosureData.scale. Default 1. */
  scale?: number
}

export interface ItemConstraint {
  type: 'snapToAnchor' | 'lockAxis' | 'noOverlap' | 'mirrorPair'
  target?: string
  axis?: 'x' | 'y' | 'z'
  /** For `mirrorPair`: distance (m) between the two rule reference points. */
  distance?: number
  /**
   * For `snapToAnchor`: which bottom corner of the item collider sits on the
   * anchor (index 0-3: -x-z, +x-z, -x+z, +x+z). Omitted = item center.
   */
  corner?: number
  /**
   * For `snapToAnchor`: id of the product snap point (declared in the GLB,
   * see io/itemSnaps.ts) sitting on the anchor. Wins over `corner`.
   */
  point?: string
}

/**
 * A snap point declared inside a product GLB (`SNAP_*` node or extras
 * `kind: "snap"`), in the item's local frame (origin = collider center).
 */
export interface ItemSnapPoint {
  id: string
  position: Vec3
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
  metadata?: ProjectMetadata
}

export interface Configurator3DProps {
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
  onChange?: (project: ProjectData) => void
  onSave?: (project: ProjectData) => void
  /** Fires once a remote catalog URL has been loaded and validated. */
  onCatalogLoaded?: (items: CatalogItem[]) => void
  /** Fires if a remote catalog URL fails to load or validate. */
  onCatalogError?: (error: Error) => void
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
