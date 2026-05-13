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
}

export interface CatalogItem {
  id: string
  label: string
  glbUrl: string
  size?: Vec3
}

export interface ItemConstraint {
  type: 'snapToAnchor' | 'lockAxis' | 'noOverlap'
  target?: string
  axis?: 'x' | 'y' | 'z'
}

export interface PlacedItem {
  id: string
  catalogId: string
  position: Vec3
  rotation: Euler
  locked?: boolean
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
  initialProject: ProjectData
  /**
   * Item catalog. Accepts either an inline array or a URL string pointing to a
   * JSON file. The JSON may be a bare CatalogItem[] or a wrapped
   * { version, items, metadata? } document.
   */
  catalog?: CatalogItem[] | string
  onChange?: (project: ProjectData) => void
  onSave?: (project: ProjectData) => void
  /** Fires once a remote catalog URL has been loaded and validated. */
  onCatalogLoaded?: (items: CatalogItem[]) => void
  /** Fires if a remote catalog URL fails to load or validate. */
  onCatalogError?: (error: Error) => void
  readOnly?: boolean
  className?: string
  style?: React.CSSProperties
}

export const PROJECT_SCHEMA_VERSION = 1
