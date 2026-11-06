import { z } from 'zod'
import type {
  AssemblyManifest,
  AssetCorrection,
  CatalogItem,
  EnclosureData,
  EnclosureDefinition,
  HoleColumn,
  ItemSnapPoint,
  ManifestSnapPoint,
  ProductAssemblyDefinition,
  Vec3,
} from '../types'
import { normalizeProductCode, parseAssemblyManifest } from '../assembly/manifest'

/**
 * Production catalogue: the folder of customer GLBs, listed by the backend
 * as a `CatalogIndex`, plus the assembly manifest of the same revision. The
 * catalogue entries are built here, by one generic path, from the file data
 * (code, folder, body bounds, hash) and the manifest (labels, rules, points):
 * there is no per-product code.
 */

export const CATALOG_INDEX_VERSION = 1

/** One GLB of the catalogue folder, as the backend lists it. */
export interface CatalogAsset {
  /** File name without extension: the product code (`KDW40236`). */
  code: string
  /** Path inside the catalogue folder (`ORIZZONTALI/KDW40236.glb`). */
  file: string
  /** Where the client downloads it. */
  url: string
  /** First folder of `file`, or empty for files at the top level. */
  category: string
  /** SHA-256 of the file, hex. */
  sha256: string
  bytes: number
  triangles: number
  /** Visible body bounds in the GLB frame, markers excluded, before any scale. */
  bounds: { min: Vec3; max: Vec3 }
  /** Preview image generated from this file. */
  preview?: string
}

/** The backend's answer for one catalogue revision. */
export interface CatalogIndex {
  version: typeof CATALOG_INDEX_VERSION
  revision: string
  createdAt?: string
  products: CatalogAsset[]
  enclosures: CatalogAsset[]
}

/** The published revision the client should use, and where its files are. */
export interface CatalogPointer {
  revision: string
  /** Index and manifest of that revision, relative to the pointer's URL. */
  index: string
  manifest: string
  report?: string
  publishedAt?: string
}

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])
const AssetSchema = z.object({
  code: z.string().min(1),
  file: z.string().min(1),
  url: z.string().min(1),
  category: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  triangles: z.number().int().nonnegative(),
  bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
  preview: z.string().min(1).optional(),
})
export const CatalogIndexSchema = z.object({
  version: z.literal(CATALOG_INDEX_VERSION),
  revision: z.string().min(1),
  createdAt: z.string().optional(),
  products: z.array(AssetSchema),
  enclosures: z.array(AssetSchema),
})
export const CatalogPointerSchema = z.object({
  revision: z.string().min(1),
  index: z.string().min(1),
  manifest: z.string().min(1),
  report: z.string().min(1).optional(),
  publishedAt: z.string().optional(),
})

/** Why a catalogue revision cannot be used. */
export type CatalogRevisionErrorCode = 'unreachable' | 'invalid' | 'revision-mismatch'

export class CatalogRevisionError extends Error {
  code: CatalogRevisionErrorCode
  url: string
  constructor(code: CatalogRevisionErrorCode, url: string, message: string) {
    super(message)
    this.name = 'CatalogRevisionError'
    this.code = code
    this.url = url
  }
}

/** One finding of the catalogue build, shown to the user and in the report. */
export interface CatalogBuildIssue {
  level: 'error' | 'warning'
  reason:
    | 'manifest-missing'
    | 'asset-missing'
    | 'correction-stale'
    | 'hole-column-empty'
    | 'point-duplicate'
  /** Catalogue id of the product or vehicle concerned. */
  product: string
  message: string
}

/** A vehicle the catalogue offers. */
export interface CatalogEnclosure {
  id: string
  label: string
  description?: string
  enclosure: EnclosureData
}

export interface BuiltCatalog {
  revision: string
  items: CatalogItem[]
  enclosures: CatalogEnclosure[]
  /** Category names in catalogue order. */
  categories: string[]
  issues: CatalogBuildIssue[]
}

const round = (value: number) => Math.round(value * 1e6) / 1e6
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scaled = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]
const unit = (v: Vec3): Vec3 => scaled(v, 1 / Math.hypot(...v)).map(round) as Vec3

/** The correction written for this exact file, if any; the others are stale. */
export function correctionFor<T extends { asset: string }>(corrections: T[] | undefined, sha256: string): { current?: T; stale: T[] } {
  const current = corrections?.find((correction) => sha256.startsWith(correction.asset))
  return { current, stale: (corrections ?? []).filter((correction) => correction !== current) }
}

/**
 * Hole centres of one column in the GLB frame. Without `count` or `length`
 * the column runs as far as hole centres stay inside the body bounds.
 */
export function holeColumnPositions(column: HoleColumn, bounds: { min: Vec3; max: Vec3 }): Vec3[] {
  const step = Math.hypot(...column.pitch)
  const direction = scaled(column.pitch, 1 / step)
  let reach = column.length
  if (reach === undefined && column.count === undefined) {
    reach = Infinity
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(direction[axis]) < 1e-9) continue
      const limit = direction[axis] > 0 ? bounds.max[axis] - column.first[axis] : bounds.min[axis] - column.first[axis]
      reach = Math.min(reach, limit / direction[axis])
    }
  }
  const count = column.count ?? (reach! < -1e-9 ? 0 : Math.floor(reach! / step + 1e-6) + 1)
  const inward = column.sheet ? scaled(unit(column.sheet.outward), -column.sheet.thickness) : [0, 0, 0] as Vec3
  return Array.from({ length: count }, (_, k) => add(add(column.first, scaled(column.pitch, k)), inward))
}

export interface ResolvedProductPoints {
  /** In the collider frame, metres. */
  points: ItemSnapPoint[]
  replaceKinds: string[]
  scale: number
  directions: Record<string, Vec3>
  correction?: AssetCorrection
  issues: CatalogBuildIssue[]
}

/**
 * The contact points the manifest gives a product, moved from the GLB frame
 * into the collider frame (origin at the centre of the visible body, metres
 * after scale). Hole columns and manifest points always apply; an asset
 * correction only to the file it was written for.
 */
export function resolveProductPoints(definition: ProductAssemblyDefinition, asset: Pick<CatalogAsset, 'sha256' | 'bounds'>): ResolvedProductPoints {
  const issues: CatalogBuildIssue[] = []
  const { current, stale } = correctionFor(definition.assetCorrections, asset.sha256)
  for (const correction of stale) {
    issues.push({ level: 'warning', reason: 'correction-stale', product: definition.catalogId,
      message: `Correzione per il file ${correction.asset} non applicata: il GLB è cambiato (${asset.sha256.slice(0, 12)}). ${correction.reason}` })
  }
  const scale = current?.scale ?? 1
  const center = scaled(add(asset.bounds.min, asset.bounds.max), 0.5)
  const toLocal = (p: Vec3): Vec3 => p.map((value, i) => round((value - center[i]) * scale)) as Vec3
  const fromManifest = (point: ManifestSnapPoint): ItemSnapPoint => ({
    id: point.id, kind: point.kind, ...(point.label ? { label: point.label } : {}),
    position: toLocal(point.position), ...(point.normal ? { normal: unit(point.normal) } : {}),
  })
  const points: ItemSnapPoint[] = []
  for (const column of definition.holeColumns ?? []) {
    const positions = holeColumnPositions(column, asset.bounds)
    if (!positions.length) {
      issues.push({ level: 'error', reason: 'hole-column-empty', product: definition.catalogId, message: `La colonna di fori ${column.id} non ha fori dentro il prodotto` })
    }
    positions.forEach((position, k) => points.push({
      id: `${column.id}-${k + 1}`, kind: column.kind, label: `${column.label ?? column.id} ${k + 1}`,
      position: toLocal(position), normal: unit(column.normal),
    }))
  }
  points.push(...(definition.points ?? []).map(fromManifest), ...(current?.points ?? []).map(fromManifest))
  const ids = new Set<string>()
  for (const point of points) {
    if (ids.has(point.id)) issues.push({ level: 'error', reason: 'point-duplicate', product: definition.catalogId, message: `Il punto ${point.id} è dichiarato due volte` })
    ids.add(point.id)
  }
  const replaceKinds = [...new Set([
    ...(definition.holeColumns ?? []).map((column) => column.kind),
    ...(current?.points ?? []).map((point) => point.kind),
    ...(current?.replaceKinds ?? []),
  ])]
  return { points, replaceKinds, scale, directions: { ...definition.directions, ...current?.directions }, correction: current, issues }
}

const sizeOf = (bounds: { min: Vec3; max: Vec3 }): Vec3 => bounds.max.map((value, i) => round(value - bounds.min[i])) as Vec3

/** The catalogue entry of one product: file data plus its manifest definition. */
export function catalogItemFor(definition: ProductAssemblyDefinition, asset: CatalogAsset, manifest?: Pick<AssemblyManifest, 'categories'>): { item: CatalogItem; issues: CatalogBuildIssue[] } {
  const resolved = resolveProductPoints(definition, asset)
  const category = definition.category ?? manifest?.categories?.[asset.category] ?? asset.category
  const item: CatalogItem = {
    id: definition.catalogId,
    code: asset.code,
    label: definition.label ?? definition.bom?.label ?? asset.code,
    glbUrl: asset.url,
    size: sizeOf(asset.bounds),
    scale: resolved.scale,
    category,
    assetHash: asset.sha256,
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.instructions?.length ? { instructions: definition.instructions } : {}),
    ...(asset.preview ? { previewUrl: asset.preview } : {}),
    ...(resolved.points.length ? { snapPoints: resolved.points } : {}),
    replaceSnapKinds: resolved.replaceKinds,
    ...(Object.keys(resolved.directions).length ? { snapDirections: resolved.directions } : {}),
    ...(definition.mirrorPair ? { mirrorPair: definition.mirrorPair } : {}),
  }
  return { item, issues: resolved.issues }
}

/** The enclosure data of one vehicle: the GLB plus what the manifest adds. */
export function enclosureFor(definition: EnclosureDefinition, asset: CatalogAsset): { enclosure: CatalogEnclosure; issues: CatalogBuildIssue[] } {
  const { current, stale } = correctionFor(definition.assetCorrections, asset.sha256)
  const issues = stale.map<CatalogBuildIssue>((correction) => ({ level: 'warning', reason: 'correction-stale', product: definition.id,
    message: `Correzione per il file ${correction.asset} non applicata: il GLB è cambiato. ${correction.reason}` }))
  const dimensions = current?.dimensions ?? definition.dimensions
  const floor = current?.floor ?? definition.floor
  const anchors = current?.anchors ?? definition.anchors
  const enclosure: EnclosureData = {
    glbUrl: asset.url,
    ...(current?.scale ? { scale: current.scale } : {}),
    ...(dimensions ? { dimensions } : {}),
    ...(floor ? { floor } : {}),
    ...(anchors ? { anchors } : {}),
    ...(definition.doors ? { doors: definition.doors } : {}),
  }
  return { enclosure: { id: definition.id, label: definition.label, ...(definition.description ? { description: definition.description } : {}), enclosure }, issues }
}

/**
 * Build the whole catalogue of a revision. A GLB without a manifest entry, or
 * a manifest entry without its GLB, is left out and reported: the client
 * never invents a product.
 */
export function buildCatalogFromIndex(index: CatalogIndex, manifest: AssemblyManifest): BuiltCatalog {
  const issues: CatalogBuildIssue[] = []
  const items: CatalogItem[] = []
  const assets = new Map(index.products.map((asset) => [normalizeProductCode(asset.code), asset]))
  const defined = new Set<string>()
  for (const definition of manifest.products) {
    const id = normalizeProductCode(definition.code ?? definition.catalogId)
    defined.add(id)
    const asset = assets.get(id)
    if (!asset) {
      issues.push({ level: 'error', reason: 'asset-missing', product: definition.catalogId, message: `GLB del prodotto ${definition.code ?? definition.catalogId} non presente nella revisione ${index.revision}` })
      continue
    }
    const built = catalogItemFor(definition, asset, manifest)
    items.push(built.item)
    issues.push(...built.issues)
  }
  for (const [id, asset] of assets) {
    if (!defined.has(id)) issues.push({ level: 'error', reason: 'manifest-missing', product: id, message: `${asset.file} non ha una definizione nel manifest` })
  }
  const enclosures: CatalogEnclosure[] = []
  const vehicles = new Map(index.enclosures.map((asset) => [normalizeProductCode(asset.code), asset]))
  for (const definition of manifest.enclosures ?? []) {
    const asset = vehicles.get(normalizeProductCode(definition.code ?? definition.id))
    if (!asset) {
      issues.push({ level: 'error', reason: 'asset-missing', product: definition.id, message: `GLB del veicolo ${definition.code ?? definition.id} non presente nella revisione ${index.revision}` })
      continue
    }
    const built = enclosureFor(definition, asset)
    enclosures.push(built.enclosure)
    issues.push(...built.issues)
  }
  const categories = [...new Set(items.map((item) => item.category ?? ''))]
  return { revision: index.revision, items, enclosures, categories, issues }
}

export interface LoadedCatalogRevision {
  pointer: CatalogPointer
  index: CatalogIndex
  manifest: AssemblyManifest
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

async function fetchJson(url: string, fetcher: FetchLike, signal?: AbortSignal): Promise<unknown> {
  let response
  try {
    response = await fetcher(url, { signal })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new CatalogRevisionError('unreachable', url, `${url} non raggiungibile: ${(error as Error).message}`)
  }
  if (!response.ok) throw new CatalogRevisionError('unreachable', url, `${url}: HTTP ${response.status}`)
  try {
    return JSON.parse(await response.text())
  } catch (error) {
    throw new CatalogRevisionError('invalid', url, `${url} non è JSON valido: ${(error as Error).message}`)
  }
}

const resolveUrl = (path: string, base: string) => {
  try { return new URL(path, base).href } catch { return path }
}

/**
 * Load a published revision through its pointer (`current.json`, or the
 * pointer of one specific revision). Index, manifest and pointer must name the
 * same revision: a mix is refused rather than half-used.
 */
export async function loadCatalogRevision(pointerUrl: string, options: { fetch?: FetchLike; signal?: AbortSignal; baseUrl?: string } = {}): Promise<LoadedCatalogRevision> {
  const fetcher = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const base = options.baseUrl ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/')
  const absolute = resolveUrl(pointerUrl, base)
  const rawPointer = CatalogPointerSchema.safeParse(await fetchJson(absolute, fetcher, options.signal))
  if (!rawPointer.success) throw new CatalogRevisionError('invalid', absolute, `${pointerUrl}: puntatore di revisione non valido`)
  const pointer = rawPointer.data
  const indexUrl = resolveUrl(pointer.index, absolute)
  const rawIndex = CatalogIndexSchema.safeParse(await fetchJson(indexUrl, fetcher, options.signal))
  if (!rawIndex.success) throw new CatalogRevisionError('invalid', indexUrl, `Indice del catalogo non valido: ${rawIndex.error.issues[0]?.message}`)
  const manifestUrl = resolveUrl(pointer.manifest, absolute)
  let manifest: AssemblyManifest
  try {
    manifest = parseAssemblyManifest(await fetchJson(manifestUrl, fetcher, options.signal))
  } catch (error) {
    if (error instanceof CatalogRevisionError) throw error
    throw new CatalogRevisionError('invalid', manifestUrl, (error as Error).message)
  }
  const index = rawIndex.data as CatalogIndex
  // Asset and preview URLs are relative to the index: make them absolute once.
  for (const asset of [...index.products, ...index.enclosures]) {
    asset.url = resolveUrl(asset.url, indexUrl)
    if (asset.preview) asset.preview = resolveUrl(asset.preview, indexUrl)
  }
  if (index.revision !== pointer.revision || (manifest.revision && manifest.revision !== pointer.revision)) {
    throw new CatalogRevisionError('revision-mismatch', absolute,
      `Revisione incoerente: puntatore ${pointer.revision}, indice ${index.revision}, manifest ${manifest.revision ?? '—'}`)
  }
  return { pointer, index, manifest }
}

/** Pointer URL of one published revision, next to `current.json`. */
export function catalogRevisionPointerUrl(currentUrl: string, revision: string): string {
  return currentUrl.replace(/[^/]*$/, `revisions/${encodeURIComponent(revision)}/pointer.json`)
}
