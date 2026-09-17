import { z } from 'zod'
import type {
  AssemblyManifest,
  Connection,
  ConnectorDefinition,
  ItemRule,
  ItemSnapPoint,
  ProjectData,
  ProductAssemblyDefinition,
} from '../types'
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
  version: z.number().int().nonnegative(),
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

export async function loadAssemblyManifest(source: AssemblyManifest | string): Promise<AssemblyManifest> {
  if (typeof source !== 'string') return parseAssemblyManifest(source)
  const response = await fetch(source)
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

export function connectorsCanMate(
  source: ConnectorDefinition,
  sourcePoint: ItemSnapPoint,
  target: ConnectorDefinition,
  targetPoint: ItemSnapPoint,
): boolean {
  const sourceAllowed = source.compatibleWith
  const targetAllowed = target.compatibleWith
  if (sourceAllowed && !sourceAllowed.includes(target.id) && !sourceAllowed.includes(targetPoint.kind)) return false
  if (targetAllowed && !targetAllowed.includes(source.id) && !targetAllowed.includes(sourcePoint.kind)) return false
  return canMate(sourcePoint.kind, targetPoint.kind)
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
