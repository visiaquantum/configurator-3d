export { Configurator3D } from './Configurator3D'
export { useConfiguratorStore } from './state/store'
export {
  serializeProject,
  parseProject,
  ProjectParseError,
} from './io/serialize'
export type { ParseOptions, ParseResult, ProjectIssue } from './io/serialize'
export { migrateProject, MigrationError } from './io/migrations'
export { ProjectDataSchema } from './io/schema'
export {
  parseCatalog,
  loadCatalog,
  CatalogParseError,
  CatalogDataSchema,
  CatalogItemSchema,
  CATALOG_SCHEMA_VERSION,
} from './io/catalog'
export type { CatalogIssue } from './io/catalog'
export {
  captureCanvasImage,
  exportSceneGLB,
  exportProjectPDF,
  downloadBlob,
} from './io/export'
export type { ExportPdfOptions } from './io/export'
export type {
  ProjectData,
  EnclosureData,
  PlacedItem,
  CatalogItem,
  Anchor,
  ItemConstraint,
  ItemRule,
  ItemSnapPoint,
  Configurator3DProps,
  ConfiguratorHandle,
  ProjectMetadata,
  Vec3,
  Euler,
} from './types'
export { PROJECT_SCHEMA_VERSION } from './types'
