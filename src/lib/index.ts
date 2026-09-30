export { Configurator3D } from './Configurator3D'
export { useConfiguratorStore, useConfiguratorStoreApi, createConfiguratorStore } from './state/store'
export type { ConfiguratorStore, ConfiguratorState } from './state/store'
export { beginAttachment, chooseAttachmentPoint, chooseAttachmentTarget, backAttachment, attachmentPoints, computeAttachmentPreview } from './scene/attachment'
export type { AttachmentInteraction } from './scene/attachment'
export { ConfiguratorStoreProvider } from './state/ConfiguratorStoreProvider'
export { configurationStatus, validationForState } from './state/readiness'
export {
  serializeProject,
  parseProject,
  ProjectParseError,
} from './io/serialize'
export type { ParseOptions, ParseResult, ProjectIssue } from './io/serialize'
export { migrateProject, MigrationError } from './io/migrations'
export { ProjectDataSchema } from './io/schema'
export {
  AssemblyManifestSchema,
  AssemblyManifestError,
  parseAssemblyManifest,
  loadAssemblyManifest,
  inferLegacyConnections,
  connectionsAtPose,
  connectorForSnap,
  connectorsCanMate,
} from './assembly/manifest'
export { validateConfiguration, hasBlockingIssues } from './assembly/validation'
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
  assemblyGroup,
  assemblyPosePatches,
  canMate,
  dedupeJoints,
  itemSnapConstraint,
  jointsSurvivingMove,
  itemSnapConstraintFor,
  listMatingTargets,
  MATING_RULES,
  positionForItemSnap,
  resolveSnappedChildren,
  rotateGroupPatches,
  snapKindLabel,
  snapPointLabel,
  snapsForItem,
  SNAP_KIND_LABELS,
  linkedPartners,
  yawToMate,
} from './scene/mating'
export type { AssemblyContext, MatingTarget } from './scene/mating'
export { computePartnerPlacement, mirrorPairDistances, pairDistanceForSpan } from './scene/mirrorPair'
export {
  extractItemSnapsFromObject,
  hydrateItemSnapsAndHide,
} from './io/itemSnaps'
export type { ExtractedSnapPoint } from './io/itemSnaps'
export {
  extractRulesFromObject,
  hydrateItemRulesAndHide,
} from './io/rules'
export type { ExtractedRule } from './io/rules'
export {
  extractAutoSnapGridFromObject,
  AUTO_SNAP_GRID_RULE,
  AUTO_GRID_SNAP_KIND,
} from './io/autoSnapGrid'
export {
  captureCanvasImage,
  buildProjectBom,
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
  ColliderBox,
  ConnectorClearanceBox,
  BomComponent,
  ConnectorDefinition,
  ProductAssemblyDefinition,
  AssemblyManifest,
  Connection,
  ValidationIssue,
  ValidationContext,
  ConfiguratorTelemetryEvent,
  Configurator3DProps,
  ConfiguratorTheme,
  ConfiguratorHandle,
  ProjectMetadata,
  Vec3,
  Euler,
} from './types'
export { PROJECT_SCHEMA_VERSION } from './types'
