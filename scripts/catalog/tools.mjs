// Shared helpers of the catalogue tools: read the GLB folder, load the
// models in Node and build the revision index the backend serves. The checks
// themselves are the library's (`checkCatalog`), so the CLI, the tests and a
// backend run exactly the same rules.
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { normalizeProductCode, visibleBodyBounds, CATALOG_INDEX_VERSION } from '../../dist/configurator-3d.js'

const posix = (path) => path.split(sep).join('/')
const round = (value) => Math.round(value * 1e6) / 1e6

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

export function parseGlb(data) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '', (gltf) => resolve(gltf.scene), reject)
  })
}

async function listGlbs(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listGlbs(root, path))
    else if (/\.glb$/i.test(entry.name)) files.push(posix(relative(root, path)))
  }
  return files
}

function triangleCount(root) {
  let count = 0
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return
    const index = node.geometry.getIndex()
    count += Math.floor((index ? index.count : node.geometry.getAttribute('position').count) / 3)
  })
  return count
}

/**
 * Every GLB of the folder with what the index carries: code, category, hash,
 * size, triangles and visible body bounds. Files whose code a manifest vehicle
 * names are vehicles; everything else is a product. A file that does not load
 * is listed with `error` and no bounds.
 */
export async function scanCatalogFolder(modelsDir, manifest) {
  const vehicleCodes = new Set((manifest?.enclosures ?? []).map((vehicle) => normalizeProductCode(vehicle.code ?? vehicle.id)))
  const assets = []
  const models = {}
  for (const file of await listGlbs(modelsDir)) {
    const data = await readFile(join(modelsDir, file))
    const code = file.split('/').pop().replace(/\.glb$/i, '')
    const parts = file.split('/')
    const asset = {
      code, file, category: parts.length > 1 ? parts[0] : '', sha256: sha256(data), bytes: (await stat(join(modelsDir, file))).size,
      triangles: 0, bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      vehicle: vehicleCodes.has(normalizeProductCode(code)),
    }
    try {
      const scene = await parseGlb(data)
      models[file] = scene
      asset.triangles = triangleCount(scene)
      const bounds = visibleBodyBounds(scene)
      // A vehicle may ship without geometry (a demo survey whose mesh did not
      // export): the check decides whether the manifest declares its volume.
      if (bounds.isEmpty() && !asset.vehicle) throw new Error('nessuna geometria visibile')
      if (!bounds.isEmpty()) asset.bounds = { min: bounds.min.toArray().map(round), max: bounds.max.toArray().map(round) }
    } catch (error) {
      models[file] = error instanceof Error ? error : new Error(String(error))
      asset.error = models[file].message
    }
    assets.push(asset)
  }
  return { assets, models }
}

/** Revision id from the content: the same files and manifest always give the same id. */
export function revisionId(manifest, assets) {
  const content = JSON.stringify({ manifest: { ...manifest, revision: undefined }, assets: assets.map((asset) => [asset.file, asset.sha256]) })
  return `rev-${sha256(content).slice(0, 12)}`
}

/** The index of one revision, with URLs relative to where the index is served. */
export function buildIndex(revision, assets, urlOf, previewOf = () => undefined) {
  const entry = (asset) => ({
    code: asset.code, file: asset.file, url: urlOf(asset), category: asset.category, sha256: asset.sha256,
    bytes: asset.bytes, triangles: asset.triangles, bounds: asset.bounds,
    ...(previewOf(asset) ? { preview: previewOf(asset) } : {}),
  })
  return {
    version: CATALOG_INDEX_VERSION,
    revision,
    createdAt: new Date().toISOString(),
    products: assets.filter((asset) => !asset.vehicle).map(entry),
    enclosures: assets.filter((asset) => asset.vehicle).map(entry),
  }
}

export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].replace(/^--/, '').split('=')
    if (inline !== undefined) args[key] = inline
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[key] = argv[++i]
    else args[key] = true
  }
  return args
}
