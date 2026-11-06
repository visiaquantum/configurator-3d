import { Vector3 } from 'three'
import type { Object3D } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { CatalogItem, ItemRule, ItemSnapPoint, MirrorPairOptions, Vec3 } from '../types'
import type { ProductMetadata } from '../io/productMetadata'
import { hydrateItemRulesAndHide } from '../io/rules'
import { hydrateItemSnapsAndHide } from '../io/itemSnaps'
import { AUTO_SNAP_GRID_RULE, extractAutoSnapGridFromObject } from '../io/autoSnapGrid'
import { visibleBodyBounds } from './geometry'
import { MIRROR_PAIR_RULE } from './mirrorPair'
import { own } from '../util/record'

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v)
  return v.map((value) => +(value / length).toFixed(6)) as Vec3
}

export interface PreparedProductAsset {
  /** Shared template: clone before changing materials or transforms. */
  scene: Object3D
  offset: Vec3
  metadata: ProductMetadata
}

const preparedAssets = new WeakMap<Object3D, Map<string, PreparedProductAsset>>()

/**
 * Every point id unique within a product: joints, capacity and `find(id)`
 * address points by id. Catalogue-declared points keep theirs; a GLB point
 * that repeats an id is renumbered (`face`, `face-2`, …).
 */
function uniqueSnapIds(generated: ItemSnapPoint[], declared: ItemSnapPoint[]): ItemSnapPoint[] {
  const used = new Set(declared.map((point) => point.id))
  const renamed = generated.map((point) => {
    let id = point.id
    for (let n = 2; used.has(id); n++) id = `${point.id}-${n}`
    used.add(id)
    return id === point.id ? point : { ...point, id }
  })
  return [...renamed, ...declared]
}

/** The catalogue's axis and spacings win over the GLB's; the reference point stays the model's. */
function withMirrorPairOptions(rules: ItemRule[], options: MirrorPairOptions | undefined): ItemRule[] {
  if (!options) return rules
  const length = options.axis ? Math.hypot(...options.axis) : 0
  return rules.map((rule) => rule.rule !== MIRROR_PAIR_RULE ? rule : {
    ...rule,
    axis: options.axis && length > 1e-9 ? options.axis.map((value) => +(value / length).toFixed(6)) as Vec3 : rule.axis,
    params: { ...rule.params, ...(options.distances ? { distances: options.distances } : {}) },
  })
}

/** Only model/geometry inputs belong in the cache key, not labels or instance poses. */
export function productAssetKey(catalog: CatalogItem): string {
  return JSON.stringify([catalog.glbUrl, catalog.scale ?? 1, catalog.size, catalog.snapPoints, catalog.autoSnapGrid, catalog.mirrorPair, catalog.replaceSnapKinds, catalog.snapDirections])
}

/** Resolve once per GLB/configuration, without mutating the loader cache or requiring React/WebGL. */
export function prepareProductAsset(source: Object3D, catalog: CatalogItem): PreparedProductAsset {
  const key = productAssetKey(catalog)
  let variants = preparedAssets.get(source)
  const cached = variants?.get(key)
  if (cached) return cached

  const scene = cloneSkeleton(source)
  const scale = catalog.scale ?? 1
  scene.scale.setScalar(scale)
  scene.updateMatrixWorld(true)
  const modelRules = withMirrorPairOptions(hydrateItemRulesAndHide(scene), catalog.mirrorPair)
  const modelSnaps = hydrateItemSnapsAndHide(scene)
  const config = typeof catalog.autoSnapGrid === 'object' ? catalog.autoSnapGrid : {}
  const existingGrid = modelRules.some((rule) => rule.rule === AUTO_SNAP_GRID_RULE)
  // `autoSnapGrid: false` in the catalogue also switches off a rule the GLB declares.
  const gridRules: ItemRule[] = catalog.autoSnapGrid === false
    ? modelRules.filter((rule) => rule.rule !== AUTO_SNAP_GRID_RULE)
    : existingGrid
      ? modelRules.map((rule) => rule.rule === AUTO_SNAP_GRID_RULE ? { ...rule, params: { ...rule.params, ...config } } : rule)
      : catalog.autoSnapGrid ? [...modelRules, { rule: AUTO_SNAP_GRID_RULE, position: [0, 0, 0], axis: [1, 0, 0], params: { ...config } }] : modelRules
  const gridSnaps = extractAutoSnapGridFromObject(scene, gridRules)
  const bounds = visibleBodyBounds(scene)
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
    throw new Error('Il modello non contiene geometria visibile valida')
  }
  const bodySize = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  const size: Vec3 = catalog.size
    ? catalog.size.map((value) => value * scale) as Vec3
    : [Math.max(bodySize.x, 0.005), Math.max(bodySize.y, 0.005), Math.max(bodySize.z, 0.005)]
  const offset: Vec3 = [-center.x, -size[1] / 2 - bounds.min.y, -center.z]
  const toLocal = (position: Vec3): Vec3 => position.map((value, index) => value + offset[index]) as Vec3
  const declared = catalog.snapPoints ?? []
  // Precedence: declared points (manifest hole columns, points, asset
  // corrections) replace GLB markers with their id and of the kinds the
  // catalogue names; the remaining markers take the manifest direction, else
  // the one deduced from the face they sit on. Each correction applies once.
  const replacedKinds = new Set(catalog.replaceSnapKinds ?? declared.map((point) => point.kind))
  const declaredIds = new Set(declared.map((point) => point.id))
  const directions = catalog.snapDirections ?? {}
  const metadata: ProductMetadata = {
    size,
    rules: modelRules.map((rule) => ({ ...rule, position: toLocal(rule.position) })),
    snaps: uniqueSnapIds([
      ...[...modelSnaps, ...gridSnaps].filter((point) => !replacedKinds.has(point.kind) && !declaredIds.has(point.id))
        .map((point) => {
          const direction = own(directions, point.id) ?? own(directions, point.kind)
          return {
            id: point.id, kind: point.kind, position: toLocal(point.position),
            ...(direction ? { normal: unit(direction) } : point.normal ? { normal: point.normal } : {}),
          }
        }),
    ], structuredClone(declared)),
  }
  const prepared = { scene, offset, metadata }
  if (!variants) { variants = new Map(); preparedAssets.set(source, variants) }
  if (variants.size >= 16) variants.clear()
  variants.set(key, prepared)
  return prepared
}
