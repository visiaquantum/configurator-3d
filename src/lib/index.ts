export { Configurator3D } from './Configurator3D'
/** Icons and palette of the built-in panels, for host panels that should look the same. */
export { Icon } from './ui/Icon'
export type { IconName } from './ui/Icon'
export { themeStyles } from './ui/theme'
export { createEnclosureCutaway } from './scene/enclosureCutaway'
export { useConfiguratorStore, useConfiguratorStoreApi, createConfiguratorStore } from './state/store'
export type { ConfiguratorStore, ConfiguratorState, CameraPreset, CameraProjection } from './state/store'
export { selectAssemblyView, selectCanMove, selectCollisionBounds, selectEffectiveAnchors, selectJoints, selectSelectedItem } from './state/selectors'
export type { AssemblyView } from './state/selectors'
export { isResolvedJoint, jointsOf, pendingJoints } from './assembly/graph'
export type { Joint } from './assembly/graph'
export { beginAttachment, chooseAttachmentPoint, chooseAttachmentTarget, backAttachment, attachmentPoints, attachmentPointStates, attachmentTargetStates, computeAttachmentPreview } from './scene/attachment'
export type { AttachmentInteraction, AttachmentPointState, AttachmentPointStatus, AttachmentTargetState } from './scene/attachment'
export { productCompatibility, compatibleCatalogIds } from './assembly/compatibility'
export type { ProductCompatibility, ProductIncompatibility } from './assembly/compatibility'
export { pairSpacingOptions } from './assembly/pairSpacing'
export type { PairSpacingOption } from './assembly/pairSpacing'
export { setMirrorPairDistance } from './scene/commands'
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
  connectionsAtPose,
  connectorForSnap,
  connectorsCanMate,
  definitionFor,
  normalizeProductCode,
} from './assembly/manifest'
export type { ManifestIssue } from './assembly/manifest'
export { validateConfiguration, hasBlockingIssues } from './assembly/validation'
export { VALIDATION_MESSAGES_IT } from './assembly/messages'
export type { ValidationReason, ValidationParams } from './assembly/messages'
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
  jointsSurvivingMove,
  listMatingTargets,
  MATING_RULES,
  positionForItemSnap,
  rotateGroupPatches,
  snapKindLabel,
  snapPointLabel,
  snapsForItem,
  SNAP_KIND_LABELS,
  linkedPartners,
  yawToMate,
} from './scene/mating'
export type { MatingTarget } from './scene/mating'
export { computePartnerPlacement, mirrorPairDistances, pairDistanceForSpan } from './scene/mirrorPair'
export {
  extractItemSnapsFromObject,
  hydrateItemSnapsAndHide,
  inspectSnapMarkers,
} from './io/itemSnaps'
export type { ExtractedSnapPoint, SnapMarkerReport } from './io/itemSnaps'
export { extractAnchorsFromGLB } from './io/anchors'
export { prepareProductAsset } from './scene/productAsset'
export type { PreparedProductAsset } from './scene/productAsset'
export { visibleBodyBounds } from './scene/geometry'
export {
  buildCatalogFromIndex,
  catalogItemFor,
  catalogRevisionPointerUrl,
  CatalogIndexSchema,
  CatalogPointerSchema,
  CatalogRevisionError,
  CATALOG_INDEX_VERSION,
  correctionFor,
  enclosureFor,
  holeColumnPositions,
  loadCatalogRevision,
  resolveProductPoints,
} from './io/productCatalog'
export type {
  BuiltCatalog,
  CatalogAsset,
  CatalogBuildIssue,
  CatalogEnclosure,
  CatalogIndex,
  CatalogPointer,
  CatalogRevisionErrorCode,
  LoadedCatalogRevision,
  ResolvedProductPoints,
} from './io/productCatalog'
export { checkCatalog, composeAssemblySample, formatCatalogReport, DEFAULT_CATALOG_THRESHOLDS } from './io/catalogCheck'
export type { CatalogCheckCode, CatalogCheckInput, CatalogCheckIssue, CatalogCheckReport, CatalogCheckSeverity, CatalogThresholds } from './io/catalogCheck'
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
  captureCanvasBlob,
  buildProjectBom,
  exportSceneGLB,
  exportProjectPDF,
  downloadBlob,
} from './io/export'
export type { BomLine, ExportPdfOptions } from './io/export'
export { ISOMETRIC_VIEWS, ISOMETRIC_VIEW_LABELS, defaultIsometricViews } from './scene/isometric'
export { exportIsometricSheetPDF } from './io/isometricSheet'
export type { IsometricSheetOptions, IsometricSheetView } from './io/isometricSheet'
export type {
  ProjectData,
  EnclosureData,
  EnclosureDoor,
  EnclosureDefinition,
  ManifestSnapPoint,
  HoleColumn,
  AssetCorrection,
  ManifestReview,
  AssemblySample,
  AssemblySampleStep,
  ProjectCatalogRef,
  PlacedItem,
  CatalogItem,
  MirrorPairOptions,
  Anchor,
  ItemConstraint,
  SnapToAnchorConstraint,
  SnapToItemConstraint,
  LockAxisConstraint,
  MirrorPairConstraint,
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
  IsometricView,
  IsometricExportOptions,
  IsometricViewImage,
  ProjectMetadata,
  Vec3,
  Euler,
} from './types'
export { PROJECT_SCHEMA_VERSION } from './types'
