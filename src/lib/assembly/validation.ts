import type {
  AssemblyManifest,
  CatalogItem,
  Connection,
  ConnectorClearanceBox,
  ConnectorDefinition,
  ItemRule,
  ItemSnapPoint,
  PlacedItem,
  ProjectData,
  ValidationContext,
  ValidationIssue,
  Vec3,
} from '../types'
import { connectorsCanMate, definitionFor } from './manifest'
import { mirrorScaleFor, snapsForItem } from '../scene/mating'

interface Bounds {
  min: Vec3
  max: Vec3
}

const EPSILON = 1e-6

function productSize(item: PlacedItem, catalog: Record<string, CatalogItem>, manifest?: AssemblyManifest | null): Vec3 {
  const definition = definitionFor(manifest, item.catalogId)
  const fromCollider = definition?.colliders?.[0]?.size
  const fromCatalog = catalog[item.catalogId]?.size
  const scale = catalog[item.catalogId]?.scale ?? 1
  const size = fromCollider ?? fromCatalog ?? [0.1, 0.1, 0.1]
  return [size[0] * scale, size[1] * scale, size[2] * scale]
}

function boundsFor(item: PlacedItem, catalog: Record<string, CatalogItem>, manifest?: AssemblyManifest | null): Bounds[] {
  const definition = definitionFor(manifest, item.catalogId)
  const scale = catalog[item.catalogId]?.scale ?? 1
  const bodySize = productSize(item, catalog, manifest)
  const colliders = definition?.colliders?.length
    ? definition.colliders
    : [{ id: 'body', center: [0, 0, 0] as Vec3, size: bodySize }]
  const yaw = item.rotation[1]
  const c = Math.abs(Math.cos(yaw))
  const s = Math.abs(Math.sin(yaw))
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return colliders.map((collider) => {
    const sx = collider.size[0] * scale
    const sy = collider.size[1] * scale
    const sz = collider.size[2] * scale
    const cx = item.position[0] + (collider.center[0] * cos + collider.center[2] * sin) * scale
    const cy = item.position[1] + bodySize[1] / 2 + collider.center[1] * scale
    const cz = item.position[2] + (-collider.center[0] * sin + collider.center[2] * cos) * scale
    const hx = (c * sx + s * sz) / 2
    const hz = (s * sx + c * sz) / 2
    return {
      min: [cx - hx, cy - sy / 2, cz - hz],
      max: [cx + hx, cy + sy / 2, cz + hz],
    }
  })
}

function overlap(a: Bounds, b: Bounds): Vec3 | null {
  const value: Vec3 = [
    Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]),
    Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]),
    Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]),
  ]
  return value.every((n) => n > EPSILON) ? value : null
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.min[0] <= inner.min[0] + EPSILON && outer.max[0] >= inner.max[0] - EPSILON &&
    outer.min[1] <= inner.min[1] + EPSILON && outer.max[1] >= inner.max[1] - EPSILON &&
    outer.min[2] <= inner.min[2] + EPSILON && outer.max[2] >= inner.max[2] - EPSILON
  )
}

function intersectionBounds(a: Bounds, b: Bounds): Bounds | null {
  if (!overlap(a, b)) return null
  return {
    min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
    max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
  }
}

function transformBounds(item: PlacedItem, bodyHeight: number, center: Vec3, size: Vec3, scale: number): Bounds {
  const yaw = item.rotation[1]
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const c = Math.abs(cos)
  const s = Math.abs(sin)
  const cx = item.position[0] + (center[0] * cos + center[2] * sin) * scale
  const cy = item.position[1] + bodyHeight / 2 + center[1] * scale
  const cz = item.position[2] + (-center[0] * sin + center[2] * cos) * scale
  const hx = (c * size[0] + s * size[2]) / 2
  const hz = (s * size[0] + c * size[2]) / 2
  return {
    min: [cx - hx, cy - size[1] * scale / 2, cz - hz],
    max: [cx + hx, cy + size[1] * scale / 2, cz + hz],
  }
}

function pointFor(item: PlacedItem, pointId: string, context: ValidationContext): ItemSnapPoint | undefined {
  return snapsForItem(item, context.itemSnaps ?? {}, context.itemRules ?? {}).find((point) => point.id === pointId)
}

function worldPoint(item: PlacedItem, local: Vec3, bodyHeight: number): Vec3 {
  const yaw = item.rotation[1]
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return [
    item.position[0] + local[0] * cos + local[2] * sin,
    item.position[1] + bodyHeight / 2 + local[1],
    item.position[2] - local[0] * sin + local[2] * cos,
  ]
}

function clearanceBounds(
  item: PlacedItem,
  point: ItemSnapPoint | undefined,
  connector: ConnectorDefinition | undefined,
  catalog: Record<string, CatalogItem>,
  manifest?: AssemblyManifest | null,
  itemRules: Record<string, ItemRule[]> = {},
): Bounds[] {
  if (!point || !connector?.clearance?.length) return []
  const bodyHeight = productSize(item, catalog, manifest)[1]
  const scale = catalog[item.catalogId]?.scale ?? 1
  // The box is offset from the point in the catalogue's frame, so the mirrored
  // half needs it flipped too — otherwise the void sits on the far side of the
  // face and the joint its twin accepts reads as a collision here.
  const mirror = mirrorScaleFor(item, itemRules) ?? [1, 1, 1]
  return connector.clearance.map((clearance: ConnectorClearanceBox) => transformBounds(
    item,
    bodyHeight,
    [
      point.position[0] + clearance.center[0] * mirror[0],
      point.position[1] + clearance.center[1] * mirror[1],
      point.position[2] + clearance.center[2] * mirror[2],
    ],
    clearance.size,
    scale,
  ))
}

function connectionBetween(a: string, b: string, connections: Connection[]): Connection | undefined {
  return connections.find(
    (connection) =>
      (connection.sourceItemId === a && connection.targetItemId === b) ||
      (connection.sourceItemId === b && connection.targetItemId === a),
  )
}

/** A joint may only interpenetrate along its declared insertion axis. */
function allowedJointOverlap(
  connection: Connection,
  source: PlacedItem,
  target: PlacedItem,
  overlapSize: Vec3,
  intersection: Bounds,
  sourcePoint: ItemSnapPoint | undefined,
  targetPoint: ItemSnapPoint | undefined,
  catalog: Record<string, CatalogItem>,
  manifest?: AssemblyManifest | null,
  itemRules: Record<string, ItemRule[]> = {},
): boolean {
  const sourceDefinition = definitionFor(manifest, source.catalogId)
  const targetDefinition = definitionFor(manifest, target.catalogId)
  const sourceConnector = sourceDefinition?.connectors.find((c) => c.id === connection.sourceConnectorId)
  const targetConnector = targetDefinition?.connectors.find((c) => c.id === connection.targetConnectorId)
  const depth = Math.max(sourceConnector?.insertionDepth ?? 0, targetConnector?.insertionDepth ?? 0)
  if (depth <= 0) return false
  // A connector defined for a family of holes inherits the selected hole's
  // face normal. A fixed insertionAxis is still available for asymmetric
  // connectors such as a tab or hook.
  const axis = sourceConnector?.insertionAxis ?? sourcePoint?.normal ?? targetConnector?.insertionAxis ?? [0, 0, 1]
  const worldAxis: Vec3 = [
    axis[0] * Math.cos(source.rotation[1]) + axis[2] * Math.sin(source.rotation[1]),
    axis[1],
    -axis[0] * Math.sin(source.rotation[1]) + axis[2] * Math.cos(source.rotation[1]),
  ]
  const dominant = Math.abs(worldAxis[0]) >= Math.abs(worldAxis[1]) && Math.abs(worldAxis[0]) >= Math.abs(worldAxis[2])
    ? 0
    : Math.abs(worldAxis[1]) >= Math.abs(worldAxis[2]) ? 1 : 2
  if (overlapSize[dominant] > depth + EPSILON) return false
  const clearance = [
    ...clearanceBounds(source, sourcePoint, sourceConnector, catalog, manifest, itemRules),
    ...clearanceBounds(target, targetPoint, targetConnector, catalog, manifest, itemRules),
  ]
  // New manifests must explicitly state the permitted void. Omitting it keeps
  // the connection valid only where no collider intersects, never by blanket
  // exemption. This prevents a shallow but unrelated overlap from passing.
  return clearance.some((zone) => contains(zone, intersection))
}

export function validateConfiguration(
  project: ProjectData | null,
  catalog: Record<string, CatalogItem>,
  manifest?: AssemblyManifest | null,
  context: ValidationContext = {},
): ValidationIssue[] {
  if (!project) return []
  const issues: ValidationIssue[] = []
  const connections = project.connections ?? []
  const byId = new Map(project.items.map((item) => [item.id, item]))

  for (const item of project.items) {
    if (!catalog[item.catalogId]) {
      issues.push({
        level: 'warning',
        code: 'unknown-product',
        message: `Prodotto ${item.catalogId} non presente nel catalogo corrente`,
        itemIds: [item.id],
      })
    }
  }

  const occupied = new Map<string, number>()
  const graph = new Map<string, string[]>()
  for (const connection of connections) {
    const source = byId.get(connection.sourceItemId)
    const target = byId.get(connection.targetItemId)
    if (!source || !target || source.id === target.id) {
      issues.push({ level: 'error', code: 'connection', message: 'Connessione con item non valido', itemIds: [connection.sourceItemId, connection.targetItemId] })
      continue
    }
    const children = graph.get(source.id) ?? []
    children.push(target.id)
    graph.set(source.id, children)
    const sourceDef = definitionFor(manifest, source.catalogId)
    const targetDef = definitionFor(manifest, target.catalogId)
    const sourceConnector = sourceDef?.connectors.find((c) => c.id === connection.sourceConnectorId)
    const targetConnector = targetDef?.connectors.find((c) => c.id === connection.targetConnectorId)
    if (!sourceConnector || !targetConnector) {
      issues.push({ level: 'error', code: 'connection', message: 'Connettore assente dal manifest', itemIds: [source.id, target.id] })
      continue
    }
    const sourcePoint = pointFor(source, connection.sourcePointId, context)
    const targetPoint = pointFor(target, connection.targetPointId, context)
    if (sourcePoint && targetPoint && !connectorsCanMate(sourceConnector, sourcePoint, targetConnector, targetPoint)) {
      issues.push({ level: 'error', code: 'connection', message: 'Connettori non compatibili', itemIds: [source.id, target.id] })
    }
    if (sourcePoint && targetPoint) {
      const sourceWorld = worldPoint(source, sourcePoint.position, productSize(source, catalog, manifest)[1])
      const targetWorld = worldPoint(target, targetPoint.position, productSize(target, catalog, manifest)[1])
      const distance = Math.hypot(sourceWorld[0] - targetWorld[0], sourceWorld[1] - targetWorld[1], sourceWorld[2] - targetWorld[2])
      const tolerance = Math.max(sourceConnector.snapTolerance ?? 0.002, targetConnector.snapTolerance ?? 0.002)
      if (distance > tolerance) {
        issues.push({ level: 'error', code: 'connection', message: `Snap non allineati (${(distance * 1000).toFixed(1)} mm)`, itemIds: [source.id, target.id] })
      }
    }
    for (const key of [`${source.id}:${connection.sourcePointId}`, `${target.id}:${connection.targetPointId}`]) {
      occupied.set(key, (occupied.get(key) ?? 0) + 1)
    }
    if ((occupied.get(`${source.id}:${connection.sourcePointId}`) ?? 0) > (sourceConnector.capacity ?? 1) ||
        (occupied.get(`${target.id}:${connection.targetPointId}`) ?? 0) > (targetConnector.capacity ?? 1)) {
      issues.push({ level: 'error', code: 'connector-capacity', message: 'Punto di snap già occupato', itemIds: [source.id, target.id] })
    }
  }

  // Assemblies are directed from the item being positioned to the item it
  // follows. A cycle has no stable parent frame, so it must be corrected
  // before propagation or export rather than relying on a renderer guard.
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const path: string[] = []
  let cycle: string[] | null = null
  const visit = (id: string) => {
    if (cycle || visited.has(id)) return
    if (visiting.has(id)) {
      const start = path.indexOf(id)
      cycle = start >= 0 ? path.slice(start) : [id]
      return
    }
    visiting.add(id)
    path.push(id)
    graph.get(id)?.forEach(visit)
    path.pop()
    visiting.delete(id)
    visited.add(id)
  }
  graph.forEach((_, itemId) => visit(itemId))
  if (cycle) {
    issues.push({
      level: 'error',
      code: 'connection',
      message: 'Connessioni cicliche non consentite',
      itemIds: cycle,
    })
  }

  for (let i = 0; i < project.items.length; i += 1) {
    for (let j = i + 1; j < project.items.length; j += 1) {
      const a = project.items[i]
      const b = project.items[j]
      const connection = connectionBetween(a.id, b.id, connections)
      const source = connection?.sourceItemId === a.id ? a : b
      const target = connection?.sourceItemId === a.id ? b : a
      const sourcePoint = connection ? pointFor(source, connection.sourcePointId, context) : undefined
      const targetPoint = connection ? pointFor(target, connection.targetPointId, context) : undefined
      let invalid = false
      for (const aBounds of boundsFor(a, catalog, manifest)) {
        for (const bBounds of boundsFor(b, catalog, manifest)) {
          const intersection = overlap(aBounds, bBounds)
          const area = intersectionBounds(aBounds, bBounds)
          if (!intersection || !area) continue
          if (connection && allowedJointOverlap(connection, source, target, intersection, area, sourcePoint, targetPoint, catalog, manifest, context.itemRules ?? {})) continue
          invalid = true
          break
        }
        if (invalid) break
      }
      if (invalid) issues.push({
        level: 'error',
        code: 'collision',
        message: `Collisione non consentita tra ${a.catalogId} e ${b.catalogId}`,
        itemIds: [a.id, b.id],
      })
    }
  }
  if (context.enclosureBounds) {
    for (const item of project.items) {
      for (const bounds of boundsFor(item, catalog, manifest)) {
        const enclosure = context.enclosureBounds
        if (
          bounds.min[0] < enclosure.min[0] - EPSILON || bounds.max[0] > enclosure.max[0] + EPSILON ||
          bounds.min[1] < enclosure.min[1] - EPSILON || bounds.max[1] > enclosure.max[1] + EPSILON ||
          bounds.min[2] < enclosure.min[2] - EPSILON || bounds.max[2] > enclosure.max[2] + EPSILON
        ) {
          issues.push({ level: 'error', code: 'out-of-bounds', message: `Prodotto ${item.catalogId} fuori dal vano`, itemIds: [item.id] })
          break
        }
      }
    }
  }
  return issues
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error')
}
