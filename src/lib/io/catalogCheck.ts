import { Box3, Euler, Matrix4, Mesh, Quaternion, Triangle, Vector3 } from 'three'
import type { Object3D } from 'three'
import type {
  AssemblyManifest,
  AssemblySample,
  CatalogItem,
  Connection,
  ItemRule,
  ItemSnapPoint,
  PlacedItem,
  ProjectData,
  Vec3,
} from '../types'
import { connectionsAtPose, connectorForSnap, definitionFor, normalizeProductCode } from '../assembly/manifest'
import { validateConfiguration } from '../assembly/validation'
import { dedupeJoints } from '../assembly/graph'
import { MATING_RULES, mirrorScaleFor, positionForItemSnap, snapsForItem, yawToMate } from '../scene/mating'
import { computePartnerPlacement, MIRROR_PAIR_RULE } from '../scene/mirrorPair'
import { rotateVector, worldPoint } from '../scene/geometry'
import { prepareProductAsset } from '../scene/productAsset'
import type { PreparedProductAsset } from '../scene/productAsset'
import { inspectSnapMarkers } from './itemSnaps'
import { extractAnchorsFromGLB } from './anchors'
import { buildCatalogFromIndex } from './productCatalog'
import type { CatalogIndex } from './productCatalog'
import { own } from '../util/record'

/**
 * Catalogue check: what must hold before a revision of GLBs and manifest is
 * published. Pure over loaded models, so the backend, a CLI or a test can run
 * it; reading the folder and loading the GLBs is the caller's job.
 *
 * Severities: `error` blocks the publication, `warning` is published but
 * listed, `confirm` is a mechanical rule the customer still has to confirm.
 * The check verifies the data; it cannot verify the mechanical intent.
 */

export type CatalogCheckSeverity = 'error' | 'warning' | 'confirm'

export type CatalogCheckCode =
  | 'manifest-invalid'
  | 'glb-unreadable'
  | 'code-duplicate'
  | 'manifest-missing'
  | 'asset-missing'
  | 'marker-duplicate'
  | 'marker-malformed'
  | 'marker-legacy'
  | 'point-missing'
  | 'reference-unknown'
  | 'parameter-invalid'
  | 'correction-stale'
  | 'size-suspicious'
  | 'marker-off-surface'
  | 'direction-ambiguous'
  | 'model-heavy'
  | 'hole-outside-body'
  | 'enclosure-anchors-missing'
  | 'enclosure-volume-missing'
  | 'enclosure-geometry-missing'
  | 'sample-invalid'
  | 'sample-connections'
  | 'sheet-overlap'
  | 'review-pending'

export interface CatalogCheckIssue {
  severity: CatalogCheckSeverity
  code: CatalogCheckCode
  /** GLB path inside the catalogue folder, when one file is concerned. */
  file?: string
  /** Catalogue id of the product, vehicle or sample. */
  product?: string
  /** Snap point, connector, column or step concerned. */
  point?: string
  message: string
  /** What to do about it. */
  action: string
}

export interface CatalogThresholds {
  /** Smallest body side, metres: below it the model is probably not in metres. */
  minBodySize: number
  /** Largest body side, metres: above it the model is probably in millimetres. */
  maxBodySize: number
  /** How far a marker centre may lie from the plane of its face, metres. */
  markerSurfaceTolerance: number
  maxTriangles: number
  maxBytes: number
  /** How far a hung part may reach past the sheet's inner face, metres. */
  sheetTolerance: number
}

export const DEFAULT_CATALOG_THRESHOLDS: CatalogThresholds = {
  minBodySize: 0.002,
  maxBodySize: 5,
  markerSurfaceTolerance: 0.0002,
  maxTriangles: 200_000,
  maxBytes: 8 * 1024 * 1024,
  sheetTolerance: 0.0001,
}

/** Default action per check, in the words of whoever has to act. */
const ACTIONS: Record<CatalogCheckCode, string> = {
  'manifest-invalid': 'Correggere il manifest nei campi indicati.',
  'glb-unreadable': 'Riesportare il GLB dal CAD e sostituire il file.',
  'code-duplicate': 'Rinominare uno dei file: il codice prodotto deve essere unico.',
  'manifest-missing': 'Aggiungere il prodotto al manifest oppure togliere il GLB dalla cartella.',
  'asset-missing': 'Aggiungere il GLB alla cartella oppure togliere il prodotto dal manifest.',
  'marker-duplicate': 'Dare a ogni marker SNAP_<TIPO>__<NOME> un nome unico nel file e riesportare.',
  'marker-malformed': 'Rinominare il marker come SNAP_<TIPO>__<NOME> (lettere, numeri e trattino basso).',
  'marker-legacy': 'Riesportare con marker SNAP_<TIPO>__<NOME>: i marker numerati cambiano a ogni esportazione.',
  'point-missing': 'Aggiungere il marker al GLB o correggere snapId/snapKind del connettore.',
  'reference-unknown': 'Correggere il riferimento: deve nominare un connettore, un tipo di punto o un prodotto esistente.',
  'parameter-invalid': 'Correggere il parametro nel manifest.',
  'correction-stale': 'Il GLB è cambiato: verificare il nuovo file e togliere o aggiornare la correzione.',
  'size-suspicious': 'Controllare unità (metri) e scala dell’esportazione.',
  'marker-off-surface': 'Spostare il centro del marker sulla superficie di contatto.',
  'direction-ambiguous': 'Mettere il marker al centro di una faccia, non su uno spigolo, o dichiarare la direzione nel manifest.',
  'model-heavy': 'Semplificare il modello o ridurre la tassellatura prima della pubblicazione.',
  'hole-outside-body': 'Correggere first/pitch/count della colonna di fori.',
  'enclosure-anchors-missing': 'Aggiungere al GLB i cubetti anchor_<NOME> sul pianale, o dichiararli nel manifest.',
  'enclosure-volume-missing': 'Aggiungere al GLB il solido Body_interior, o dichiarare vano e pianale nel manifest.',
  'enclosure-geometry-missing': 'Riesportare il GLB con le mesh del veicolo (nuvole di punti e mesh solo grafiche non vengono esportate).',
  'sample-invalid': 'Correggere il manifest o i GLB finché l’assieme campione è valido.',
  'sample-connections': 'Verificare connettori e posizioni: l’assieme campione non forma gli agganci attesi.',
  'sheet-overlap': 'Il pezzo appeso supera la lamiera del fianco: spostare il marker sulla faccia della staffa.',
  'review-pending': 'Far confermare al cliente le regole di aggancio del prodotto e registrarlo in review.',
}

export interface CatalogCheckInput {
  index: CatalogIndex
  manifest: AssemblyManifest
  /** Loaded GLB scenes by file path (`CatalogAsset.file`); an Error for a file that did not load. */
  models: Record<string, Object3D | Error>
  thresholds?: Partial<CatalogThresholds>
}

export interface CatalogCheckReport {
  revision: string
  checkedAt: string
  thresholds: CatalogThresholds
  summary: { products: number; enclosures: number; samples: number; errors: number; warnings: number; confirmations: number }
  /** True when the revision must not be published. */
  blocking: boolean
  issues: CatalogCheckIssue[]
}

const issue = (severity: CatalogCheckSeverity, code: CatalogCheckCode, message: string, where: Partial<Pick<CatalogCheckIssue, 'file' | 'product' | 'point'>> = {}, action = ACTIONS[code]): CatalogCheckIssue =>
  ({ severity, code, ...where, message, action })

const mm = (metres: number) => `${(metres * 1000).toFixed(2)} mm`

/** Body meshes of a prepared model in its root space: visible, outside marker subtrees, not stray marker cubes. */
function bodyMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  const size = new Vector3()
  const box = new Box3()
  const visit = (object: Object3D) => {
    if (!object.visible || /^(snap|anchor|rule)[_:]/i.test(object.name) || ['snap', 'anchor', 'rule'].includes(object.userData.kind)) return
    if (object instanceof Mesh) {
      box.setFromObject(object).getSize(size)
      // Unnamed instances of the 1 mm marker cubes are not the body.
      if (!(size.x < 0.002 && size.y < 0.002 && size.z < 0.002)) meshes.push(object)
    }
    object.children.forEach(visit)
  }
  root.updateMatrixWorld(true)
  visit(root)
  return meshes
}

/** Faces farther than this from a marker are not its face: a fixing hole is smaller. */
const MARKER_FACE_RADIUS = 0.012

/**
 * Distance from a marker centre to the plane of the face it sits on. The
 * contract puts the centre on the contact face at the centre of the fixing
 * hole, where there is no material: so the distance is measured to the plane
 * of the nearby faces (those within `MARKER_FACE_RADIUS`, parallel to the
 * marker's direction when it has one), not to the mesh. Infinity when no face
 * is near at all.
 */
function distanceToFace(point: Vec3, normal: Vec3 | undefined, meshes: Mesh[]): number {
  const p = new Vector3(...point)
  const triangle = new Triangle()
  const closest = new Vector3()
  const plane = new Vector3()
  const box = new Box3()
  const direction = normal ? new Vector3(...normal).normalize() : null
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  let best = Infinity
  for (const mesh of meshes) {
    box.setFromObject(mesh)
    if (box.distanceToPoint(p) > MARKER_FACE_RADIUS) continue
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const count = index ? index.count : position.count
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld)
      triangle.set(a, b, c)
      if (triangle.closestPointToPoint(p, closest).distanceTo(p) > MARKER_FACE_RADIUS) continue
      triangle.getNormal(plane)
      if (plane.lengthSq() < 0.5 || (direction && Math.abs(plane.dot(direction)) < 0.95)) continue
      const distance = Math.abs(plane.dot(closest.copy(p).sub(a)))
      if (distance < best) best = distance
    }
  }
  return best
}

/** World matrix of a placed item's model, as Item.tsx renders it. */
function placedMatrix(item: PlacedItem, prepared: PreparedProductAsset, height: number, mirror: Vec3 | null): Matrix4 {
  const world = new Matrix4().compose(
    new Vector3(item.position[0], item.position[1] + height / 2, item.position[2]),
    new Quaternion().setFromEuler(new Euler(...item.rotation)),
    new Vector3(1, 1, 1),
  )
  if (mirror) world.multiply(new Matrix4().makeScale(...mirror))
  return world.multiply(new Matrix4().makeTranslation(...prepared.offset))
}

interface SampleContext {
  catalog: Record<string, CatalogItem>
  manifest: AssemblyManifest
  itemSnaps: Record<string, ItemSnapPoint[]>
  itemRules: Record<string, ItemRule[]>
  itemSizes: Record<string, Vec3>
}

/**
 * Compose a manifest sample with the editor's own mating math: a step on a
 * point turns the part a quarter turn at a time until the two faces oppose,
 * then puts its point on the target's; a twin is the mirror pair at the given
 * spacing. Every joint that lines up is bound, as on a manual release.
 */
export function composeAssemblySample(sample: AssemblySample, context: SampleContext): { project: ProjectData; problems: Array<{ step: string; message: string }> } {
  const items: PlacedItem[] = []
  const problems: Array<{ step: string; message: string }> = []
  const heightOf = (item: PlacedItem) => own(context.itemSizes, item.catalogId)?.[1] ?? 0
  const byId = (id: string) => items.find((item) => item.id === id)
  for (const step of sample.steps) {
    if ('twinOf' in step) {
      const half = byId(step.twinOf)
      const rule = half && own(context.itemRules, half.catalogId)?.find((entry) => entry.rule === MIRROR_PAIR_RULE)
      if (!half || !rule) { problems.push({ step: step.id, message: `${step.twinOf} non esiste o non dichiara la coppia specchiata` }); continue }
      const twin = computePartnerPlacement(half, rule, step.distance)
      half.constraints = [...(half.constraints ?? []), { type: 'mirrorPair', target: step.id, distance: step.distance }]
      items.push({ id: step.id, catalogId: half.catalogId, ...twin, constraints: [{ type: 'mirrorPair', target: half.id, distance: step.distance }] })
      continue
    }
    if (!own(context.catalog, step.product)) { problems.push({ step: step.id, message: `prodotto ${step.product} assente dal catalogo` }); continue }
    if (!('on' in step)) {
      items.push({ id: step.id, catalogId: step.product, position: step.position ?? [0, 0, 0], rotation: [0, step.yaw ?? 0, 0] })
      continue
    }
    const target = byId(step.on)
    const draft: PlacedItem = { id: step.id, catalogId: step.product, position: [0, 0, 0], rotation: [0, 0, 0] }
    const mine = snapsForItem(draft, context.itemSnaps, context.itemRules).find((point) => point.id === step.point)
    const theirs = target && snapsForItem(target, context.itemSnaps, context.itemRules).find((point) => point.id === step.at)
    if (!target || !mine || !theirs) { problems.push({ step: step.id, message: `punto ${step.product}:${step.point} o ${step.on}:${step.at} inesistente` }); continue }
    const yaw = yawToMate(mine.normal, theirs.normal, target.rotation[1])
    if (yaw === null) { problems.push({ step: step.id, message: `nessun quarto di giro oppone ${step.point} a ${step.at}` }); continue }
    const position = positionForItemSnap(mine.position, yaw, heightOf(draft), worldPoint(target, theirs.position, heightOf(target)))
    items.push({ ...draft, position, rotation: [0, yaw, 0] })
  }
  const connections: Connection[] = dedupeJoints(items.flatMap((item) => connectionsAtPose(item, item, {
    items, itemSnaps: context.itemSnaps, itemRules: context.itemRules, manifest: context.manifest, heightOf,
  })))
  return { project: { id: `sample-${sample.id}`, version: 1, enclosure: { glbUrl: 'sample' }, items, connections }, problems }
}

/** Everything of a hung part that reaches into a perforated product must stay behind its sheet. */
function sheetOverlaps(project: ProjectData, context: SampleContext, prepared: Record<string, PreparedProductAsset>, tolerance: number): string[] {
  const found: string[] = []
  const byId = new Map(project.items.map((item) => [item.id, item]))
  const heightOf = (item: PlacedItem) => own(context.itemSizes, item.catalogId)?.[1] ?? 0
  for (const connection of project.connections ?? []) {
    for (const [partId, sideId, sidePointId] of [
      [connection.sourceItemId, connection.targetItemId, connection.targetPointId],
      [connection.targetItemId, connection.sourceItemId, connection.sourcePointId],
    ]) {
      const part = byId.get(partId)!
      const side = byId.get(sideId)!
      const column = definitionFor(context.manifest, side.catalogId)?.holeColumns
        ?.find((entry) => entry.sheet && new RegExp(`^${entry.id}-\\d+$`).test(sidePointId))
      const asset = own(prepared, part.catalogId)
      if (!column?.sheet || !asset) continue
      const hole = snapsForItem(side, context.itemSnaps, context.itemRules).find((point) => point.id === sidePointId)!
      const mirror = mirrorScaleFor(side, context.itemRules) ?? [1, 1, 1]
      const length = Math.hypot(...column.sheet.outward)
      const outward = rotateVector(column.sheet.outward.map((value, i) => value / length * mirror[i]) as Vec3, side.rotation)
      const axis = [0, 1, 2].reduce((best, i) => Math.abs(outward[i]) > Math.abs(outward[best]) ? i : best, 0)
      const sign = Math.sign(outward[axis])
      const plane = worldPoint(side, hole.position, heightOf(side))[axis] * sign
      const sideSize = own(context.itemSizes, side.catalogId)!
      const sideBox = new Box3().setFromCenterAndSize(new Vector3(0, 0, 0), new Vector3(...sideSize))
        .applyMatrix4(new Matrix4().compose(new Vector3(side.position[0], side.position[1] + sideSize[1] / 2, side.position[2]), new Quaternion().setFromEuler(new Euler(...side.rotation)), new Vector3(1, 1, 1)))
      const matrix = placedMatrix(part, asset, heightOf(part), mirrorScaleFor(part, context.itemRules))
      for (const mesh of bodyMeshes(asset.scene)) {
        const box = new Box3().setFromObject(mesh).applyMatrix4(matrix)
        if (!box.intersectsBox(sideBox)) continue
        const reach = (sign > 0 ? box.max.getComponent(axis) : -box.min.getComponent(axis)) - plane
        if (reach > tolerance) found.push(`${partId} ${mesh.name || 'mesh'} ${mm(reach)} oltre la lamiera di ${sideId}`)
      }
    }
  }
  return found
}

/** Run every catalogue check on one revision. */
export function checkCatalog(input: CatalogCheckInput): CatalogCheckReport {
  const thresholds = { ...DEFAULT_CATALOG_THRESHOLDS, ...input.thresholds }
  const { index, manifest } = input
  const issues: CatalogCheckIssue[] = []

  // Codes: one product per normalised code, across folders.
  const byCode = new Map<string, string[]>()
  for (const asset of [...index.products, ...index.enclosures]) {
    const id = normalizeProductCode(asset.code)
    byCode.set(id, [...(byCode.get(id) ?? []), asset.file])
  }
  for (const [id, files] of byCode) {
    if (files.length > 1) issues.push(issue('error', 'code-duplicate', `${files.join(', ')} hanno lo stesso codice (${id})`, { product: id, file: files[0] }))
  }

  // Every file must load, whether or not the manifest uses it.
  for (const asset of [...index.products, ...index.enclosures]) {
    const model = input.models[asset.file]
    if (!model || model instanceof Error) {
      issues.push(issue('error', 'glb-unreadable', `${asset.file} non si legge: ${model instanceof Error ? model.message : 'file assente'}`, { file: asset.file, product: normalizeProductCode(asset.code) }))
    }
  }

  const built = buildCatalogFromIndex(index, manifest)
  const fileOf = new Map([...index.products, ...index.enclosures].map((asset) => [normalizeProductCode(asset.code), asset.file]))
  for (const entry of built.issues) {
    const code: CatalogCheckCode = entry.reason === 'manifest-missing' ? 'manifest-missing'
      : entry.reason === 'asset-missing' ? 'asset-missing'
        : entry.reason === 'correction-stale' ? 'correction-stale' : 'parameter-invalid'
    issues.push(issue(entry.level, code, entry.message, { product: entry.product, file: fileOf.get(entry.product) }))
  }

  // Connector references: a `compatibleWith` entry names a connector or a point kind.
  const connectorIds = new Set(manifest.products.flatMap((product) => product.connectors.map((connector) => connector.id)))
  const knownKinds = new Set<string>(Object.keys(MATING_RULES))
  for (const item of built.items) item.snapPoints?.forEach((point) => knownKinds.add(point.kind))

  const prepared: Record<string, PreparedProductAsset> = {}
  const itemSnaps: Record<string, ItemSnapPoint[]> = {}
  const itemRules: Record<string, ItemRule[]> = {}
  const itemSizes: Record<string, Vec3> = {}
  const assets = new Map(index.products.map((asset) => [normalizeProductCode(asset.code), asset]))

  for (const item of built.items) {
    const asset = assets.get(item.id)!
    const where = { file: asset.file, product: item.id }
    const model = input.models[asset.file]
    if (!model || model instanceof Error) continue
    let ready: PreparedProductAsset
    try {
      ready = prepareProductAsset(model, item)
    } catch (error) {
      issues.push(issue('error', 'glb-unreadable', `${asset.file}: ${(error as Error).message}`, where))
      continue
    }
    prepared[item.id] = ready
    itemSnaps[item.id] = ready.metadata.snaps
    itemRules[item.id] = ready.metadata.rules
    itemSizes[item.id] = ready.metadata.size
    for (const point of ready.metadata.snaps) knownKinds.add(point.kind)

    // Markers: stable, unique, well named, on the contact surface.
    const markers = inspectSnapMarkers(ready.scene)
    for (const duplicate of markers.duplicates) {
      issues.push(issue('error', 'marker-duplicate', `Il marker ${duplicate.id} compare ${duplicate.names.length} volte`, { ...where, point: duplicate.id }))
    }
    for (const name of markers.malformed) issues.push(issue('error', 'marker-malformed', `Nome marker non valido: ${name}`, { ...where, point: name }))
    if (markers.legacy.length) {
      issues.push(issue('warning', 'marker-legacy', `${markers.legacy.length} marker senza nome stabile (${markers.legacy.slice(0, 4).join(', ')}${markers.legacy.length > 4 ? '…' : ''})`, where))
    }
    const body = bodyMeshes(ready.scene)
    for (const marker of markers.points) {
      const distance = distanceToFace(marker.position, marker.normal, body)
      if (distance > thresholds.markerSurfaceTolerance) {
        const text = Number.isFinite(distance) ? `è a ${mm(distance)} dal piano della faccia` : `non ha una faccia del prodotto entro ${mm(MARKER_FACE_RADIUS)}`
        issues.push(issue('warning', 'marker-off-surface', `Il centro del marker ${marker.name ?? marker.id} ${text}`, { ...where, point: marker.id }))
      }
    }

    // Body size and weight.
    const [x, y, z] = ready.metadata.size
    if (Math.min(x, y, z) < thresholds.minBodySize || Math.max(x, y, z) > thresholds.maxBodySize) {
      issues.push(issue('warning', 'size-suspicious', `Ingombro ${[x, y, z].map((v) => Math.round(v * 1000)).join(' × ')} mm fuori da ${mm(thresholds.minBodySize)} – ${thresholds.maxBodySize} m`, where))
    }
    if (asset.triangles > thresholds.maxTriangles || asset.bytes > thresholds.maxBytes) {
      issues.push(issue('warning', 'model-heavy', `${asset.triangles} triangoli, ${(asset.bytes / 1048576).toFixed(1)} MB (soglie ${thresholds.maxTriangles}, ${(thresholds.maxBytes / 1048576).toFixed(0)} MB)`, where))
    }

    // Connectors: every one finds its point, and every used point has a direction.
    const definition = definitionFor(manifest, item.id)!
    for (const connector of definition.connectors) {
      const points = ready.metadata.snaps.filter((point) => connector.snapId ? point.id === connector.snapId : point.kind === connector.snapKind)
      if (!points.length) {
        issues.push(issue('error', 'point-missing', `Il connettore ${connector.id} non trova il punto ${connector.snapId ?? `di tipo ${connector.snapKind}`}`, { ...where, point: connector.id }))
      }
      for (const point of points) {
        if (!point.normal && connectorForSnap(definition, point) === connector) {
          issues.push(issue('warning', 'direction-ambiguous', `Il punto ${point.id} non ha una direzione di aggancio univoca`, { ...where, point: point.id }))
        }
      }
    }
    const half = (item.size ?? [0, 0, 0]).map((value) => value * (item.scale ?? 1) / 2 + 0.001)
    for (const point of item.snapPoints ?? []) {
      if (point.position.some((value, i) => Math.abs(value) > half[i])) {
        issues.push(issue('warning', 'hole-outside-body', `Il punto ${point.id} cade fuori dall’ingombro del prodotto`, { ...where, point: point.id }))
      }
    }
    if (definition.review?.confirmed !== true) {
      issues.push(issue('confirm', 'review-pending', `Regole di aggancio di ${item.label} non ancora confermate dal cliente`, where))
    }
  }

  for (const product of manifest.products) {
    for (const connector of product.connectors) {
      for (const reference of connector.compatibleWith ?? []) {
        if (!connectorIds.has(reference) && !knownKinds.has(reference)) {
          issues.push(issue('error', 'reference-unknown', `${connector.id} accetta «${reference}», che non è un connettore né un tipo di punto`, { product: product.catalogId, point: connector.id }))
        }
      }
    }
  }

  // Vehicles: the GLB or the manifest must give the cargo volume and the anchors.
  const vehicles = new Map(index.enclosures.map((asset) => [normalizeProductCode(asset.code), asset]))
  for (const vehicle of built.enclosures) {
    const definition = manifest.enclosures!.find((entry) => entry.id === vehicle.id)!
    const asset = vehicles.get(normalizeProductCode(definition.code ?? definition.id))!
    const where = { file: asset.file, product: vehicle.id }
    const model = input.models[asset.file]
    if (!model || model instanceof Error) continue
    const root = model.clone(true)
    root.scale.setScalar(vehicle.enclosure.scale ?? 1)
    root.updateMatrixWorld(true)
    if (!vehicle.enclosure.anchors?.length && !extractAnchorsFromGLB(root).length) {
      issues.push(issue('warning', 'enclosure-anchors-missing', 'Il veicolo non ha ancoraggi anchor_<NOME> né ancoraggi nel manifest', where))
    }
    if (!vehicle.enclosure.dimensions && !vehicle.enclosure.floor && !root.getObjectByName('Body_interior')) {
      issues.push(issue('warning', 'enclosure-volume-missing', 'Il veicolo non ha Body_interior né vano o pianale nel manifest', where))
    }
    const box = new Box3().setFromObject(root)
    if (box.isEmpty()) {
      // Without geometry the viewer draws only the declared volume.
      issues.push(vehicle.enclosure.dimensions
        ? issue('warning', 'enclosure-geometry-missing', 'Il GLB del veicolo non contiene geometria: si vede solo il vano dichiarato nel manifest', where)
        : issue('error', 'enclosure-geometry-missing', 'Il GLB del veicolo non contiene geometria e il manifest non dichiara le dimensioni del vano', where))
    } else {
      const size = box.getSize(new Vector3())
      if (Math.max(size.x, size.y, size.z) > 20 || Math.max(size.x, size.y, size.z) < 0.5) {
        issues.push(issue('warning', 'size-suspicious', `Ingombro del veicolo ${size.toArray().map((v) => v.toFixed(2)).join(' × ')} m: controllare unità e scala`, where))
      }
    }
    if (definition.review?.confirmed !== true) issues.push(issue('confirm', 'review-pending', `Dati del veicolo ${vehicle.label} non ancora confermati dal cliente`, where))
  }

  // Sample assemblies: composed with the editor's math, validated like a project.
  const catalog = Object.fromEntries(built.items.map((item) => [item.id, item]))
  const context: SampleContext = { catalog, manifest, itemSnaps, itemRules, itemSizes }
  for (const sample of manifest.samples ?? []) {
    const missing = sample.steps.filter((step) => 'product' in step && !own(prepared, step.product))
    if (missing.length) {
      issues.push(issue('error', 'sample-invalid', `Assieme «${sample.label}»: prodotti non disponibili (${missing.map((step) => 'product' in step ? step.product : '').join(', ')})`, { product: sample.id }))
      continue
    }
    const { project, problems } = composeAssemblySample(sample, context)
    for (const problem of problems) issues.push(issue('error', 'sample-invalid', `Assieme «${sample.label}», passo ${problem.step}: ${problem.message}`, { product: sample.id, point: problem.step }))
    const findings = validateConfiguration(project, catalog, manifest, { itemSnaps, itemRules, itemSizes })
      .filter((finding) => finding.level === 'error')
    for (const finding of findings) {
      issues.push(issue('error', 'sample-invalid', `Assieme «${sample.label}»: ${finding.message} (${finding.itemIds.join(', ')})`, { product: sample.id }))
    }
    const joints = project.connections?.length ?? 0
    if (sample.expectConnections !== undefined && joints !== sample.expectConnections) {
      issues.push(issue('error', 'sample-connections', `Assieme «${sample.label}»: ${joints} agganci invece di ${sample.expectConnections}`, { product: sample.id }))
    }
    for (const overlap of sheetOverlaps(project, context, prepared, thresholds.sheetTolerance)) {
      issues.push(issue('error', 'sheet-overlap', `Assieme «${sample.label}»: ${overlap}`, { product: sample.id }))
    }
  }

  const count = (severity: CatalogCheckSeverity) => issues.filter((entry) => entry.severity === severity).length
  const order: CatalogCheckSeverity[] = ['error', 'warning', 'confirm']
  issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  return {
    revision: index.revision,
    checkedAt: new Date().toISOString(),
    thresholds,
    summary: {
      products: built.items.length, enclosures: built.enclosures.length, samples: manifest.samples?.length ?? 0,
      errors: count('error'), warnings: count('warning'), confirmations: count('confirm'),
    },
    blocking: count('error') > 0,
    issues,
  }
}

/** The report as plain Italian text, one line per finding, grouped by severity. */
export function formatCatalogReport(report: CatalogCheckReport): string {
  const titles: Record<CatalogCheckSeverity, string> = { error: 'ERRORI BLOCCANTI', warning: 'AVVISI', confirm: 'DA CONFERMARE CON IL CLIENTE' }
  const lines = [
    `Controllo catalogo · revisione ${report.revision} · ${report.checkedAt}`,
    `${report.summary.products} prodotti, ${report.summary.enclosures} veicoli, ${report.summary.samples} assiemi campione`,
    `${report.summary.errors} errori, ${report.summary.warnings} avvisi, ${report.summary.confirmations} conferme richieste`,
    report.blocking ? 'ESITO: NON PUBBLICABILE' : 'ESITO: PUBBLICABILE',
  ]
  for (const severity of ['error', 'warning', 'confirm'] as const) {
    const entries = report.issues.filter((entry) => entry.severity === severity)
    if (!entries.length) continue
    lines.push('', `${titles[severity]} (${entries.length})`)
    for (const entry of entries) {
      const where = [entry.file ?? entry.product, entry.point].filter(Boolean).join(' · ')
      lines.push(`- [${entry.code}] ${where ? `${where}: ` : ''}${entry.message}`, `  → ${entry.action}`)
    }
  }
  return lines.join('\n')
}
