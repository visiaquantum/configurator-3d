// The production catalogue as the client gets it, built in the test from the
// GLB folder and the source manifest with the library's own functions: no
// product data is written here.
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { Group } from 'three'
import {
  buildCatalogFromIndex,
  createConfiguratorStore,
  parseAssemblyManifest,
  prepareProductAsset,
  visibleBodyBounds,
  normalizeProductCode,
} from '../../src/lib/index.ts'
import { buildLocalCorners } from '../../src/lib/scene/itemRegistry.ts'
import { restoreLiveItems } from '../../src/lib/scene/itemMovement.ts'
import { parseGlb } from './glb.mjs'

const MODELS = 'public/models'

async function list(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await list(path))
    else if (entry.name.endsWith('.glb')) out.push(relative(MODELS, path))
  }
  return out.sort()
}

/** Index, manifest and built catalogue of the folder; scenes load on demand. */
export async function loadProductionCatalog() {
  const manifest = parseAssemblyManifest(await readFile('catalog/manifest.json', 'utf8'))
  const vehicles = new Set((manifest.enclosures ?? []).map((vehicle) => normalizeProductCode(vehicle.code ?? vehicle.id)))
  const scenes = {}
  const products = []
  const enclosures = []
  for (const file of await list(MODELS)) {
    const bytes = await readFile(join(MODELS, file))
    const scene = await parseGlb(bytes)
    scenes[file] = scene
    const bounds = visibleBodyBounds(scene)
    const code = file.split('/').pop().replace('.glb', '')
    const asset = {
      code, file, url: `/models/${file}`, category: file.includes('/') ? file.split('/')[0] : '',
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, triangles: 0,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    }
    ;(vehicles.has(normalizeProductCode(code)) ? enclosures : products).push(asset)
  }
  const index = { version: 1, revision: 'rev-test', products, enclosures }
  const built = buildCatalogFromIndex(index, manifest)
  const fileOf = Object.fromEntries(products.map((asset) => [normalizeProductCode(asset.code), asset.file]))
  const prepared = {}
  const prepare = (id) => {
    const item = built.items.find((entry) => entry.id === id)
    prepared[id] ??= prepareProductAsset(scenes[fileOf[id]], item)
    return prepared[id]
  }
  const context = (ids) => {
    const metadata = Object.fromEntries(ids.map((id) => [id, prepare(id).metadata]))
    return {
      catalog: Object.fromEntries(built.items.map((item) => [item.id, item])),
      itemSnaps: Object.fromEntries(ids.map((id) => [id, metadata[id].snaps])),
      itemRules: Object.fromEntries(ids.map((id) => [id, metadata[id].rules])),
      itemSizes: Object.fromEntries(ids.map((id) => [id, metadata[id].size])),
      manifest,
    }
  }
  return { manifest, index, built, scenes, fileOf, prepare, context }
}

/**
 * A configurator store driven the way the interface drives it: catalogue and
 * manifest set, products hydrated from their GLBs, a live group registered for
 * every placed item (what Item.tsx does on mount).
 */
export function createEditor(production, { enclosure, revision = 'rev-test' } = {}) {
  const store = createConfiguratorStore()
  const vehicle = enclosure ?? production.built.enclosures[0].enclosure
  store.getState().setCatalog(production.built.items)
  store.getState().setAssemblyManifest(production.manifest)
  store.getState().setProject({ id: 'manuale', version: 1, enclosure: vehicle, items: [], connections: [], catalog: { revision } })
  if (vehicle.dimensions) {
    const [w, h, d] = vehicle.dimensions
    store.getState().setInteriorBBox({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] })
  }
  const hydrate = () => {
    for (const item of store.getState().project.items) {
      const product = store.getState().catalog[item.catalogId]
      if (!store.getState().itemSnaps[item.catalogId]) store.getState().hydrateProduct(product, production.prepare(item.catalogId).metadata)
      if (!store.getState().itemRegistry.has(item.id)) {
        store.getState().itemRegistry.set(item.id, { id: item.id, group: new Group(), localCorners: buildLocalCorners(store.getState().itemSizes[item.catalogId]) })
      }
    }
    const placed = new Set(store.getState().project.items.map((item) => item.id))
    for (const id of [...store.getState().itemRegistry.keys()]) if (!placed.has(id)) store.getState().itemRegistry.delete(id)
    restoreLiveItems(store.getState())
  }
  return { store, hydrate }
}
