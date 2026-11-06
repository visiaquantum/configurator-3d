import { z } from 'zod'
import type {
  AssemblyManifest,
  Connection,
  Euler,
  PlacedItem,
  Vec3,
  ConnectorDefinition,
  ItemRule,
  ItemSnapPoint,
  ProductAssemblyDefinition,
} from '../types'
import { worldPoint as worldPointOf, normalsOppose } from '../scene/geometry'
import { canMate, snapsForItem } from '../scene/mating'

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])
const PositiveVec3Schema = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()])
const ConnectorSchema = z.object({
  id: z.string().min(1),
  snapId: z.string().min(1).optional(),
  snapKind: z.string().min(1).optional(),
  compatibleWith: z.array(z.string().min(1)).optional(),
  capacity: z.number().int().positive().optional(),
  insertionDepth: z.number().nonnegative().optional(),
  insertionAxis: Vec3Schema.optional(),
  clearance: z.array(z.object({
    id: z.string().min(1),
    center: Vec3Schema,
    size: PositiveVec3Schema,
  })).optional(),
  snapTolerance: z.number().positive().optional(),
  bomComponents: z.array(z.object({
    code: z.string().min(1),
    label: z.string().min(1),
    quantity: z.number().positive(),
  })).optional(),
}).refine((value) => value.snapId || value.snapKind, {
  message: 'A connector needs snapId or snapKind',
})

const ColliderSchema = z.object({
  id: z.string().min(1),
  center: Vec3Schema,
  size: PositiveVec3Schema,
})

const DirectionSchema = Vec3Schema.refine((v) => v.every(Number.isFinite) && Math.hypot(...v) > 1e-9, { message: 'Direction must not be zero' })
const ManifestPointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: z.string().min(1),
  position: Vec3Schema,
  normal: DirectionSchema.optional(),
})
const HoleColumnSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'Column id: lowercase letters, digits, - and _'),
  kind: z.string().min(1),
  label: z.string().min(1).optional(),
  first: Vec3Schema,
  pitch: DirectionSchema,
  count: z.number().int().positive().optional(),
  length: z.number().nonnegative().optional(),
  normal: DirectionSchema,
  sheet: z.object({ outward: DirectionSchema, thickness: z.number().nonnegative() }).optional(),
}).refine((column) => column.count === undefined || column.length === undefined, { message: 'A hole column takes count or length, not both' })
const Sha = z.string().regex(/^[0-9a-f]{12,64}$/, 'Asset hash: 12 to 64 hex characters')
const ReviewSchema = z.object({ confirmed: z.boolean(), by: z.string().optional(), date: z.string().optional(), notes: z.string().optional() })
const DirectionsSchema = z.record(z.string().min(1), DirectionSchema)
const AnchorSchema = z.object({ id: z.string().min(1), position: Vec3Schema, normal: DirectionSchema.optional() })
const FloorSchema = z.object({ size: PositiveVec3Schema, y: z.number(), color: z.string().min(1).optional() })
const DoorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rotate'), axis: z.enum(['y', 'z']), openAngle: z.number() }),
  z.object({ kind: z.literal('slide'), axis: z.enum(['x', 'y', 'z']), distance: z.number() }),
])

const ProductSchema = z.object({
  catalogId: z.string().min(1),
  connectors: z.array(ConnectorSchema),
  colliders: z.array(ColliderSchema).optional(),
  bom: z.object({ code: z.string().min(1).optional(), label: z.string().min(1).optional() }).optional(),
  code: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().min(1).optional(),
  instructions: z.array(z.string().min(1)).optional(),
  points: z.array(ManifestPointSchema).optional(),
  holeColumns: z.array(HoleColumnSchema).optional(),
  mirrorPair: z.object({ axis: DirectionSchema.optional(), distances: z.array(z.number().positive()).min(1).optional() }).optional(),
  bays: z.array(z.number().positive()).min(1).optional(),
  directions: DirectionsSchema.optional(),
  assetCorrections: z.array(z.object({
    asset: Sha,
    reason: z.string().min(1),
    points: z.array(ManifestPointSchema).optional(),
    replaceKinds: z.array(z.string().min(1)).optional(),
    scale: z.number().positive().optional(),
    directions: DirectionsSchema.optional(),
  })).optional(),
  review: ReviewSchema.optional(),
})

const EnclosureDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  code: z.string().min(1).optional(),
  description: z.string().optional(),
  dimensions: PositiveVec3Schema.optional(),
  floor: FloorSchema.optional(),
  anchors: z.array(AnchorSchema).optional(),
  doors: z.record(z.string().min(1), DoorSchema).optional(),
  assetCorrections: z.array(z.object({
    asset: Sha,
    reason: z.string().min(1),
    scale: z.number().positive().optional(),
    dimensions: PositiveVec3Schema.optional(),
    floor: FloorSchema.optional(),
    anchors: z.array(AnchorSchema).optional(),
  })).optional(),
  review: ReviewSchema.optional(),
})

const SampleStepSchema = z.union([
  z.object({ id: z.string().min(1), product: z.string().min(1), point: z.string().min(1), on: z.string().min(1), at: z.string().min(1) }).strict(),
  z.object({ id: z.string().min(1), twinOf: z.string().min(1), distance: z.number().positive() }).strict(),
  z.object({ id: z.string().min(1), product: z.string().min(1), position: Vec3Schema.optional(), yaw: z.number().optional() }).strict(),
])
const SampleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  steps: z.array(SampleStepSchema).min(1),
  expectConnections: z.number().int().nonnegative().optional(),
})

/** Unique ids within `values`, each duplicate reported at its own path. */
function uniqueIds(ctx: z.RefinementCtx, values: Array<{ id: string }> | undefined, path: Array<string | number>, message: string) {
  const ids = new Set<string>()
  values?.forEach((value, index) => {
    if (ids.has(value.id)) ctx.addIssue({ code: 'custom', path: [...path, index, 'id'], message })
    ids.add(value.id)
  })
}

export const AssemblyManifestSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  revision: z.string().min(1).optional(),
  categories: z.record(z.string().min(1), z.string().min(1)).optional(),
  products: z.array(ProductSchema),
  enclosures: z.array(EnclosureDefinitionSchema).optional(),
  samples: z.array(SampleSchema).optional(),
}).superRefine((manifest, ctx) => {
  const ids = new Set<string>()
  const codes = new Set<string>()
  manifest.products.forEach((product, i) => {
    if (ids.has(product.catalogId)) {
      ctx.addIssue({ code: 'custom', path: ['products', i, 'catalogId'], message: 'Duplicate catalogId' })
    }
    ids.add(product.catalogId)
    const code = normalizeProductCode(product.code ?? product.catalogId)
    if (product.code && code !== product.catalogId) {
      ctx.addIssue({ code: 'custom', path: ['products', i, 'code'], message: `Code ${product.code} normalises to ${code}, not to the catalogId` })
    }
    if (codes.has(code)) ctx.addIssue({ code: 'custom', path: ['products', i, 'code'], message: 'Duplicate product code' })
    codes.add(code)
    uniqueIds(ctx, product.connectors, ['products', i, 'connectors'], 'Duplicate connector id')
    product.connectors.forEach((connector, c) => uniqueIds(ctx, connector.clearance, ['products', i, 'connectors', c, 'clearance'], 'Duplicate clearance id'))
    uniqueIds(ctx, product.colliders, ['products', i, 'colliders'], 'Duplicate collider id')
    uniqueIds(ctx, product.holeColumns, ['products', i, 'holeColumns'], 'Duplicate hole column id')
    uniqueIds(ctx, product.points, ['products', i, 'points'], 'Duplicate point id')
    product.assetCorrections?.forEach((correction, c) => uniqueIds(ctx, correction.points, ['products', i, 'assetCorrections', c, 'points'], 'Duplicate point id'))
  })
  uniqueIds(ctx, manifest.enclosures, ['enclosures'], 'Duplicate enclosure id')
  uniqueIds(ctx, manifest.samples, ['samples'], 'Duplicate sample id')
  manifest.samples?.forEach((sample, s) => uniqueIds(ctx, sample.steps, ['samples', s, 'steps'], 'Duplicate step id'))
})

/**
 * Catalogue id of a product code or GLB file name: lower case, letters and
 * digits only (`PTBM-31.glb` → `ptbm31`). Codes that normalise to the same id
 * are the same product.
 */
export function normalizeProductCode(code: string): string {
  return code.replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface ManifestIssue {
  level: 'error'
  /** JSON path of the offending value, e.g. `$.products.0.connectors.1.id`. */
  path: string
  message: string
}

/** Like `ProjectParseError` and `CatalogParseError`: every problem, each with its path. */
export class AssemblyManifestError extends Error {
  issues: ManifestIssue[]
  constructor(message: string, issues: ManifestIssue[] = []) {
    super(message)
    this.name = 'AssemblyManifestError'
    this.issues = issues
  }
}

export function parseAssemblyManifest(raw: unknown): AssemblyManifest {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch (error) {
      const message = `Assembly manifest JSON is malformed: ${(error as Error).message}`
      throw new AssemblyManifestError(message, [{ level: 'error', path: '$', message }])
    }
  }
  const result = AssemblyManifestSchema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues.map<ManifestIssue>((issue) => ({
      level: 'error',
      path: '$' + (issue.path.length ? '.' + issue.path.join('.') : ''),
      message: issue.message,
    }))
    throw new AssemblyManifestError(`Assembly manifest failed validation: ${issues[0]?.message ?? 'invalid data'}`, issues)
  }
  return result.data as AssemblyManifest
}

export async function loadAssemblyManifest(source: AssemblyManifest | string, signal?: AbortSignal): Promise<AssemblyManifest> {
  if (typeof source !== 'string') return parseAssemblyManifest(source)
  const response = await fetch(source, { signal })
  if (!response.ok) throw new AssemblyManifestError(`Assembly manifest fetch failed: ${response.status}`)
  return parseAssemblyManifest(await response.text())
}

/** The manifest entry of a product, if any. */
export function definitionFor(
  manifest: AssemblyManifest | null | undefined,
  catalogId: string,
): ProductAssemblyDefinition | undefined {
  return manifest?.products.find((product) => product.catalogId === catalogId)
}

/**
 * The connector that owns a snap point. A connector naming the point by
 * `snapId` wins over one covering its whole `snapKind`, wherever each sits in
 * the manifest: the specific one carries that point's capacity, tolerance and
 * hardware.
 */
export function connectorForSnap(
  definition: ProductAssemblyDefinition | undefined,
  point: ItemSnapPoint,
): ConnectorDefinition | undefined {
  return definition?.connectors.find((connector) => connector.snapId === point.id) ??
    definition?.connectors.find((connector) => !connector.snapId && connector.snapKind === point.kind)
}

export function connectorOwnsPoint(connector: ConnectorDefinition, point: ItemSnapPoint): boolean {
  return connector.snapId ? connector.snapId === point.id : connector.snapKind === point.kind
}

/** Max source/target snap distance of a committed joint when a connector does not say. */
export const DEFAULT_SNAP_TOLERANCE = 0.002

/**
 * The manifest is the authority on what mates: when either connector lists
 * `compatibleWith`, that list decides. The built-in kind table
 * (`MATING_RULES`) only applies between connectors that declare nothing, so a
 * new product family needs a manifest entry, not a code change.
 */
export function connectorsCanMate(
  source: ConnectorDefinition,
  sourcePoint: ItemSnapPoint,
  target: ConnectorDefinition,
  targetPoint: ItemSnapPoint,
): boolean {
  if (!connectorOwnsPoint(source, sourcePoint) || !connectorOwnsPoint(target, targetPoint)) return false
  const sourceAllowed = source.compatibleWith
  const targetAllowed = target.compatibleWith
  if (sourceAllowed && !sourceAllowed.includes(target.id) && !sourceAllowed.includes(targetPoint.kind)) return false
  if (targetAllowed && !targetAllowed.includes(source.id) && !targetAllowed.includes(sourcePoint.kind)) return false
  return !!sourceAllowed || !!targetAllowed || canMate(sourcePoint.kind, targetPoint.kind)
}

/**
 * Every joint an item forms at the given pose.
 *
 * A part set down in a frame is bolted wherever its points line up, not only
 * at the single contact the drag happened to be nearest to: a shelf sits in
 * both uprights, and the upright that closes a frame meets every horizontal at
 * once. Recording one joint and ignoring the rest leaves them as bare
 * interpenetrations, which `validateConfiguration` reports as collisions — so
 * the closing part could never be put down at all.
 *
 * Points are bound only when they already coincide within the connectors' own
 * `snapTolerance`, so this never invents a joint the validator would reject.
 */
export function connectionsAtPose(
  item: PlacedItem,
  pose: { position: Vec3; rotation: Euler },
  context: {
    items: PlacedItem[]
    itemSnaps: Record<string, ItemSnapPoint[]>
    itemRules?: Record<string, ItemRule[]>
    itemSizes?: Record<string, Vec3>
    manifest?: AssemblyManifest | null
    /** Collider height: the datum a snap point's Y is measured from. */
    heightOf: (item: PlacedItem) => number
  },
): Connection[] {
  const definition = definitionFor(context.manifest, item.catalogId)
  if (!definition) return []
  const rules = context.itemRules ?? {}
  const posed: PlacedItem = { ...item, position: pose.position, rotation: pose.rotation }
  const height = context.heightOf(posed)
  const others = context.items.filter((other) => other.id !== item.id)
  // One target point takes one joint; capacity is checked again on validation.
  const taken = new Map<string, number>()
  const sourceTaken = new Map<string, number>()
  const connections: Connection[] = []
  for (const mine of snapsForItem(posed, context.itemSnaps, rules)) {
    const connector = connectorForSnap(definition, mine)
    if (!connector) continue
    const world = worldPointOf(posed, mine.position, height)
    for (const other of others) {
      const otherDefinition = definitionFor(context.manifest, other.catalogId)
      if (!otherDefinition) continue
      const match = snapsForItem(other, context.itemSnaps, rules).find((theirs) => {
        const otherConnector = connectorForSnap(otherDefinition, theirs)
        if (!otherConnector || !connectorsCanMate(connector, mine, otherConnector, theirs)) return false
        if (!normalsOppose(mine.normal, posed.rotation, theirs.normal, other.rotation)) return false
        if ((taken.get(`${other.id}:${theirs.id}`) ?? 0) >= (otherConnector.capacity ?? 1)) return false
        const limit = Math.min(connector.snapTolerance ?? DEFAULT_SNAP_TOLERANCE, otherConnector.snapTolerance ?? DEFAULT_SNAP_TOLERANCE)
        const there = worldPointOf(other, theirs.position, context.heightOf(other))
        return Math.hypot(there[0] - world[0], there[1] - world[1], there[2] - world[2]) <= limit
      })
      if (!match) continue
      taken.set(`${other.id}:${match.id}`, (taken.get(`${other.id}:${match.id}`) ?? 0) + 1)
      sourceTaken.set(mine.id, (sourceTaken.get(mine.id) ?? 0) + 1)
      connections.push({
        sourceItemId: item.id,
        sourceConnectorId: connector.id,
        sourcePointId: mine.id,
        targetItemId: other.id,
        targetConnectorId: connectorForSnap(otherDefinition, match)!.id,
        targetPointId: match.id,
        resolvedTransform: { position: pose.position, rotation: pose.rotation },
      })
      if ((sourceTaken.get(mine.id) ?? 0) >= (connector.capacity ?? 1)) break
    }
  }
  return connections
}

/**
 * Resolve one pending joint against the manifest: both points must exist on
 * the hydrated products and their connectors must accept each other. The
 * resolved transform records the source pose the joint was confirmed at.
 */
export function resolveJoint(
  joint: Pick<Connection, 'sourcePointId' | 'targetPointId'>,
  source: PlacedItem,
  target: PlacedItem,
  manifest: AssemblyManifest,
  itemSnaps: Record<string, ItemSnapPoint[]>,
  itemRules: Record<string, ItemRule[]>,
): Connection | null {
  const sourcePoint = snapsForItem(source, itemSnaps, itemRules).find((point) => point.id === joint.sourcePointId)
  const targetPoint = snapsForItem(target, itemSnaps, itemRules).find((point) => point.id === joint.targetPointId)
  if (!sourcePoint || !targetPoint) return null
  const sourceConnector = connectorForSnap(definitionFor(manifest, source.catalogId), sourcePoint)
  const targetConnector = connectorForSnap(definitionFor(manifest, target.catalogId), targetPoint)
  if (!sourceConnector || !targetConnector || !connectorsCanMate(sourceConnector, sourcePoint, targetConnector, targetPoint)) return null
  return {
    sourceItemId: source.id,
    sourceConnectorId: sourceConnector.id,
    sourcePointId: sourcePoint.id,
    targetItemId: target.id,
    targetConnectorId: targetConnector.id,
    targetPointId: targetPoint.id,
    resolvedTransform: { position: source.position, rotation: source.rotation },
  }
}
