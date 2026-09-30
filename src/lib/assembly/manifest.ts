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
  ProjectData,
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

export const AssemblyManifestSchema = z.object({
  version: z.literal(1),
  products: z.array(z.object({
    catalogId: z.string().min(1),
    connectors: z.array(ConnectorSchema),
    colliders: z.array(ColliderSchema).optional(),
    bom: z.object({ code: z.string().min(1).optional(), label: z.string().min(1).optional() }).optional(),
  })).superRefine((products, ctx) => {
    const ids = new Set<string>()
    products.forEach((product, i) => {
      if (ids.has(product.catalogId)) {
        ctx.addIssue({ code: 'custom', path: [i, 'catalogId'], message: 'Duplicate catalogId' })
      }
      ids.add(product.catalogId)
      const connectorIds = new Set<string>()
      const colliderIds = new Set<string>()
      product.connectors.forEach((connector, connectorIndex) => {
        if (connectorIds.has(connector.id)) {
          ctx.addIssue({ code: 'custom', path: [i, 'connectors', connectorIndex, 'id'], message: 'Duplicate connector id' })
        }
        connectorIds.add(connector.id)
        const clearanceIds = new Set<string>()
        connector.clearance?.forEach((clearance, clearanceIndex) => {
          if (clearanceIds.has(clearance.id)) {
            ctx.addIssue({ code: 'custom', path: [i, 'connectors', connectorIndex, 'clearance', clearanceIndex, 'id'], message: 'Duplicate clearance id' })
          }
          clearanceIds.add(clearance.id)
        })
      })
      product.colliders?.forEach((collider, colliderIndex) => {
        if (colliderIds.has(collider.id)) {
          ctx.addIssue({ code: 'custom', path: [i, 'colliders', colliderIndex, 'id'], message: 'Duplicate collider id' })
        }
        colliderIds.add(collider.id)
      })
    })
  }),
})

export class AssemblyManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssemblyManifestError'
  }
}

export function parseAssemblyManifest(raw: unknown): AssemblyManifest {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch (error) {
      throw new AssemblyManifestError(`Assembly manifest JSON is malformed: ${(error as Error).message}`)
    }
  }
  const result = AssemblyManifestSchema.safeParse(value)
  if (!result.success) {
    throw new AssemblyManifestError(`Assembly manifest failed validation: ${result.error.issues[0]?.message ?? 'invalid data'}`)
  }
  return result.data as AssemblyManifest
}

export async function loadAssemblyManifest(source: AssemblyManifest | string, signal?: AbortSignal): Promise<AssemblyManifest> {
  if (typeof source !== 'string') return parseAssemblyManifest(source)
  const response = await fetch(source, { signal })
  if (!response.ok) throw new AssemblyManifestError(`Assembly manifest fetch failed: ${response.status}`)
  return parseAssemblyManifest(await response.text())
}

export function definitionFor(
  manifest: AssemblyManifest | null | undefined,
  catalogId: string,
): ProductAssemblyDefinition | undefined {
  return manifest?.products.find((product) => product.catalogId === catalogId)
}

export function connectorForSnap(
  definition: ProductAssemblyDefinition | undefined,
  point: ItemSnapPoint,
): ConnectorDefinition | undefined {
  return definition?.connectors.find(
    (connector) => connector.snapId === point.id || (!connector.snapId && connector.snapKind === point.kind),
  )
}

export function connectorOwnsPoint(connector: ConnectorDefinition, point: ItemSnapPoint): boolean {
  return connector.snapId ? connector.snapId === point.id : connector.snapKind === point.kind
}

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
  return canMate(sourcePoint.kind, targetPoint.kind)
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
        const limit = Math.min(connector.snapTolerance ?? 0.002, otherConnector.snapTolerance ?? 0.002)
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

/** Converts existing `snapToItem` constraints after their GLB points hydrate. */
export function inferLegacyConnections(
  project: ProjectData,
  manifest: AssemblyManifest,
  itemSnaps: Record<string, ItemSnapPoint[]>,
  itemRules: Record<string, ItemRule[]>,
): Connection[] {
  if (project.connections) return project.connections
  const byId = new Map(project.items.map((item) => [item.id, item]))
  const connections: Connection[] = []
  for (const source of project.items) {
    const legacy = source.constraints?.find((constraint) => constraint.type === 'snapToItem')
    if (!legacy?.target || !legacy.point || !legacy.targetPoint) continue
    const target = byId.get(legacy.target)
    if (!target) continue
    const sourcePoint = snapsForItem(source, itemSnaps, itemRules).find((point) => point.id === legacy.point)
    const targetPoint = snapsForItem(target, itemSnaps, itemRules).find((point) => point.id === legacy.targetPoint)
    if (!sourcePoint || !targetPoint) continue
    const sourceConnector = connectorForSnap(definitionFor(manifest, source.catalogId), sourcePoint)
    const targetConnector = connectorForSnap(definitionFor(manifest, target.catalogId), targetPoint)
    if (!sourceConnector || !targetConnector || !connectorsCanMate(sourceConnector, sourcePoint, targetConnector, targetPoint)) continue
    connections.push({
      sourceItemId: source.id,
      sourceConnectorId: sourceConnector.id,
      sourcePointId: sourcePoint.id,
      targetItemId: target.id,
      targetConnectorId: targetConnector.id,
      targetPointId: targetPoint.id,
      resolvedTransform: { position: source.position, rotation: source.rotation },
    })
  }
  return connections
}
