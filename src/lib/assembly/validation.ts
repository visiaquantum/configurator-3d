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
import { worldPoint, transformedBounds, rotateVector, normalsOppose } from '../scene/geometry'
import { mirrorScaleFor, snapsForItem } from '../scene/mating'

interface Bounds {
  min: Vec3
  max: Vec3
}

const EPSILON = 1e-6

function productSize(item: PlacedItem, catalog: Record<string, CatalogItem>, manifest?: AssemblyManifest | null, context: ValidationContext = {}): Vec3 {
  const hydrated = context.itemSizes?.[item.catalogId]
  if (hydrated) return hydrated
  const size = catalog[item.catalogId]?.size ?? definitionFor(manifest, item.catalogId)?.colliders?.[0]?.size ?? [0.1, 0.1, 0.1]
  const scale = catalog[item.catalogId]?.scale ?? 1
  return size.map((value) => value * scale) as Vec3
}

function boundsFor(item: PlacedItem, catalog: Record<string, CatalogItem>, manifest?: AssemblyManifest | null, context: ValidationContext = {}): Bounds[] {
  const definition = definitionFor(manifest, item.catalogId)
  const scale = catalog[item.catalogId]?.scale ?? 1
  const bodySize = productSize(item, catalog, manifest, context)
  const mirror = mirrorScaleFor(item, context.itemRules ?? {}) ?? [1, 1, 1]
  if (!definition?.colliders?.length) return [transformedBounds(item, bodySize[1], [0, 0, 0], bodySize)]
  return definition.colliders.map((collider) => transformedBounds(item, bodySize[1],
    collider.center.map((value, index) => value * scale * mirror[index]) as Vec3,
    collider.size.map((value) => value * scale) as Vec3,
  ))
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

function pointFor(item: PlacedItem, pointId: string, context: ValidationContext): ItemSnapPoint | undefined {
  return snapsForItem(item, context.itemSnaps ?? {}, context.itemRules ?? {}).find((point) => point.id === pointId)
}

function clearanceBounds(
  item: PlacedItem,
  point: ItemSnapPoint | undefined,
  connector: ConnectorDefinition | undefined,
  catalog: Record<string, CatalogItem>,
  manifest?: AssemblyManifest | null,
  itemRules: Record<string, ItemRule[]> = {},
  context: ValidationContext = {},
): Bounds[] {
  if (!point || !connector?.clearance?.length) return []
  const bodyHeight = productSize(item, catalog, manifest, context)[1]
  const scale = catalog[item.catalogId]?.scale ?? 1
  // The box is offset from the point in the catalogue's frame, so the mirrored
  // half needs it flipped too — otherwise the void sits on the far side of the
  // face and the joint its twin accepts reads as a collision here.
  const mirror = mirrorScaleFor(item, itemRules) ?? [1, 1, 1]
  return connector.clearance.map((clearance: ConnectorClearanceBox) => transformedBounds(
    item,
    bodyHeight,
    [
      point.position[0] + clearance.center[0] * mirror[0] * scale,
      point.position[1] + clearance.center[1] * mirror[1] * scale,
      point.position[2] + clearance.center[2] * mirror[2] * scale,
    ],
    clearance.size.map((value) => value * scale) as Vec3,
  ))
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
  context: ValidationContext = {},
): boolean {
  const sourceDefinition = definitionFor(manifest, source.catalogId)
  const targetDefinition = definitionFor(manifest, target.catalogId)
  const sourceConnector = sourceDefinition?.connectors.find((c) => c.id === connection.sourceConnectorId)
  const targetConnector = targetDefinition?.connectors.find((c) => c.id === connection.targetConnectorId)
  const depth = Math.max((sourceConnector?.insertionDepth ?? 0) * (catalog[source.catalogId]?.scale ?? 1), (targetConnector?.insertionDepth ?? 0) * (catalog[target.catalogId]?.scale ?? 1))
  if (depth <= 0) return false
  // A connector defined for a family of holes inherits the selected hole's
  // face normal. A fixed insertionAxis is still available for asymmetric
  // connectors such as a tab or hook.
  const axis = sourceConnector?.insertionAxis ?? sourcePoint?.normal ?? targetConnector?.insertionAxis ?? [0, 0, 1]
  const worldAxis = rotateVector(axis, source.rotation)
  const dominant = Math.abs(worldAxis[0]) >= Math.abs(worldAxis[1]) && Math.abs(worldAxis[0]) >= Math.abs(worldAxis[2])
    ? 0
    : Math.abs(worldAxis[1]) >= Math.abs(worldAxis[2]) ? 1 : 2
  if (overlapSize[dominant] > depth + EPSILON) return false
  const clearance = [
    ...clearanceBounds(source, sourcePoint, sourceConnector, catalog, manifest, itemRules, context),
    ...clearanceBounds(target, targetPoint, targetConnector, catalog, manifest, itemRules, context),
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
  if (project.items.length && !manifest) issues.push({ level: 'warning', code: 'incomplete-data', message: 'Manifest tecnico assente: verifica dei connettori non disponibile', itemIds: [] })
  if (project.items.length && !context.enclosureBounds) issues.push({ level: 'warning', code: 'incomplete-data', message: 'Limiti interni del vano non disponibili: ingombro da verificare', itemIds: [] })
  const connections = project.connections ?? []
  const byId = new Map(project.items.map((item) => [item.id, item]))

  for (const item of project.items) {
    if (!Object.hasOwn(catalog, item.catalogId)) {
      issues.push({
        level: 'error',
        code: 'unknown-product',
        message: `Prodotto ${item.catalogId} non presente nel catalogo corrente`,
        itemIds: [item.id],
      })
    }
  }

  for (const item of project.items) {
    if (manifest && !definitionFor(manifest, item.catalogId)) issues.push({ level: 'error', code: 'unknown-product', message: `Prodotto ${item.catalogId} assente dal manifest tecnico`, itemIds: [item.id] })
    for (const constraint of item.constraints ?? []) {
      if (constraint.type === 'mirrorPair' && byId.has(constraint.target ?? '')) {
        const partner = byId.get(constraint.target!)!
        const reciprocal = partner.constraints?.find((c) => c.type === 'mirrorPair' && c.target === item.id)
        if (!reciprocal || partner.catalogId !== item.catalogId || reciprocal.distance !== constraint.distance) {
          issues.push({ level: 'error', code: 'connection', message: 'Coppia specchiata non reciproca o incoerente', itemIds: [item.id, partner.id] })
        }
      }
      if ((constraint.type === 'snapToItem' || constraint.type === 'mirrorPair') && (!constraint.target || !byId.has(constraint.target) || constraint.target === item.id)) {
        issues.push({ level: 'error', code: 'connection', message: 'Vincolo con item non valido', itemIds: [item.id] })
      }
      if (constraint.type === 'snapToItem' && project.connections !== undefined && !connections.some((c) => c.sourceItemId === item.id && c.targetItemId === constraint.target && c.sourcePointId === constraint.point && c.targetPointId === constraint.targetPoint)) {
        issues.push({ level: 'error', code: 'connection', message: 'Vincolo legacy privo di connessione tecnica', itemIds: [item.id] })
      }
    }
  }
  const validConnections: Connection[] = []
  const seenConnections = new Set<string>()
  const occupied = new Map<string, number>()
  const graph = new Map<string, string[]>()
  for (const connection of connections) {
    const source = byId.get(connection.sourceItemId)
    const target = byId.get(connection.targetItemId)
    if (!source || !target || source.id === target.id) {
      issues.push({ level: 'error', code: 'connection', message: 'Connessione con item non valido', itemIds: [connection.sourceItemId, connection.targetItemId] })
      continue
    }
    const connectionKey = [`${source.id}:${connection.sourcePointId}`, `${target.id}:${connection.targetPointId}`].sort().join('|')
    if (seenConnections.has(connectionKey)) {
      issues.push({ level: 'error', code: 'connection', message: 'Connessione duplicata', itemIds: [source.id, target.id] })
    }
    seenConnections.add(connectionKey)
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
    if (!sourcePoint || !targetPoint) {
      issues.push({ level: 'error', code: 'connection', message: 'Punto di snap assente o non caricato', itemIds: [source.id, target.id] })
      continue
    }
    let jointValid = true
    if (sourcePoint && targetPoint && !connectorsCanMate(sourceConnector, sourcePoint, targetConnector, targetPoint)) {
      jointValid = false
      issues.push({ level: 'error', code: 'connection', message: 'Connettori non compatibili', itemIds: [source.id, target.id] })
    }
    if (!normalsOppose(sourcePoint.normal, source.rotation, targetPoint.normal, target.rotation)) {
      jointValid = false
      issues.push({ level: 'error', code: 'connection', message: 'Normali dei connettori non opposte', itemIds: [source.id, target.id] })
    }
    if (sourcePoint && targetPoint) {
      const sourceWorld = worldPoint(source, sourcePoint.position, productSize(source, catalog, manifest, context)[1])
      const targetWorld = worldPoint(target, targetPoint.position, productSize(target, catalog, manifest, context)[1])
      const distance = Math.hypot(sourceWorld[0] - targetWorld[0], sourceWorld[1] - targetWorld[1], sourceWorld[2] - targetWorld[2])
      const tolerance = Math.min(sourceConnector.snapTolerance ?? 0.002, targetConnector.snapTolerance ?? 0.002)
      if (distance > tolerance) {
        jointValid = false
        issues.push({ level: 'error', code: 'connection', message: `Snap non allineati (${(distance * 1000).toFixed(1)} mm)`, itemIds: [source.id, target.id] })
      }
    }
    if (jointValid) validConnections.push(connection)
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

  // Transform each collider once per validation pass, then prune separated pairs on X.
  const prepared = project.items.map((item) => ({ item, boxes: boundsFor(item, catalog, manifest, context) }))
    .map((entry) => ({ ...entry, minX: Math.min(...entry.boxes.map((box) => box.min[0])), maxX: Math.max(...entry.boxes.map((box) => box.max[0])) }))
    .sort((a, b) => a.minX - b.minX)
  const connectionsByPair = new Map<string, Connection[]>()
  for (const connection of validConnections) {
    const key = [connection.sourceItemId, connection.targetItemId].sort().join('|')
    connectionsByPair.set(key, [...(connectionsByPair.get(key) ?? []), connection])
  }
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      if (prepared[j].minX >= prepared[i].maxX - EPSILON) break
      const a = prepared[i].item
      const b = prepared[j].item
      const pairConnections = connectionsByPair.get([a.id, b.id].sort().join('|')) ?? []
      let invalid = false
      for (const aBounds of prepared[i].boxes) {
        for (const bBounds of prepared[j].boxes) {
          const intersection = overlap(aBounds, bBounds)
          const area = intersectionBounds(aBounds, bBounds)
          if (!intersection || !area) continue
          if (pairConnections.some((connection) => {
            const source = connection.sourceItemId === a.id ? a : b
            const target = connection.sourceItemId === a.id ? b : a
            return allowedJointOverlap(connection, source, target, intersection, area, pointFor(source, connection.sourcePointId, context), pointFor(target, connection.targetPointId, context), catalog, manifest, context.itemRules ?? {}, context)
          })) continue
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
    for (const { item, boxes } of prepared) {
      for (const bounds of boxes) {
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
