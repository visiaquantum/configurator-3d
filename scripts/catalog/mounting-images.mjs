// Images of the mounting details of the manifest samples, for the customer
// to confirm: an overview and a horizontal section through the first hole a
// part hangs on (brackets behind the side's flange, front and back columns).
//
//   node scripts/catalog/mounting-images.mjs [--out docs/montaggio]
//   node scripts/catalog/mounting-images.mjs --project <file.json> --name <nome>
//
// With --project, the saved project is drawn instead of the samples.
//
// The samples are composed with the editor's math (`composeAssemblySample`)
// on the real GLBs; rendering is headless Chromium with software WebGL.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { composeAssemblySample, definitionFor, parseAssemblyManifest, prepareProductAsset, snapsForItem, buildCatalogFromIndex } from '../../dist/configurator-3d.js'
import { buildIndex, parseArgs, revisionId, scanCatalogFolder } from './tools.mjs'

const require = createRequire(import.meta.url)
const THREE_DIR = join(dirname(require.resolve('three')), '..')
const HOST = 'http://mounting.images'

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${HOST}/three/build/three.module.js","three/addons/":"${HOST}/three/examples/jsm/"}}</script>
</head><body style="margin:0;background:#fff"><script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
const W = 900, H = 600
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.localClippingEnabled = true
document.body.append(renderer.domElement)
const cache = new Map()
const load = (url) => { if (!cache.has(url)) cache.set(url, new GLTFLoader().loadAsync(url)); return cache.get(url) }
globalThis.renderAssembly = async ({ items, view }) => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#ffffff')
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a94a3', 1.4))
  const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(3, 5, 4); scene.add(key)
  const clip = view.section ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), view.section)] : []
  for (const item of items) {
    const { scene: source } = await load(item.url)
    const model = source.clone(true)
    model.traverse((node) => {
      if (/^(snap|rule|anchor)[_:]/i.test(node.name)) node.visible = false
      if (node.isMesh) node.material = new THREE.MeshStandardMaterial({ color: item.color, metalness: 0.1, roughness: 0.7, side: THREE.DoubleSide, clippingPlanes: clip })
    })
    model.matrixAutoUpdate = false
    model.matrix.fromArray(item.matrix)
    scene.add(model)
  }
  let camera
  if (view.section) {
    const half = view.half
    camera = new THREE.OrthographicCamera(-half * W / H, half * W / H, half, -half, 0.001, 10)
    camera.position.set(view.target[0], view.section + 1, view.target[2])
    camera.up.set(...view.up)
    camera.lookAt(view.target[0], view.section, view.target[2])
  } else {
    camera = new THREE.PerspectiveCamera(30, W / H, 0.01, 100)
    camera.position.set(...view.eye)
    camera.lookAt(...view.target)
  }
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}
globalThis.ready = true
</script></body></html>`

/** The flip of a mirrored half, along the dominant horizontal axis of its rule (as scene/mating.ts). */
function mirrorScaleFor(item, itemRules) {
  if (!item.mirrored) return null
  const rule = itemRules[item.catalogId]?.find((entry) => entry.rule === 'mirror-pair')
  return rule && Math.abs(rule.axis[2]) > Math.abs(rule.axis[0]) ? [1, 1, -1] : [-1, 1, 1]
}

/** World matrix of a placed GLB root, as Item.tsx renders it (pose, mirror, collider offset, scale). */
function rootMatrix(item, prepared, size, mirror, scale) {
  const world = new Matrix4().compose(new Vector3(item.position[0], item.position[1] + size[1] / 2, item.position[2]), new Quaternion().setFromEuler(new Euler(...item.rotation)), new Vector3(1, 1, 1))
  if (mirror) world.multiply(new Matrix4().makeScale(...mirror))
  return world.multiply(new Matrix4().makeTranslation(...prepared.offset)).multiply(new Matrix4().makeScale(scale, scale, scale))
}

const args = parseArgs(process.argv.slice(2))
const out = args.out ?? 'docs/montaggio'
const models = args.models ?? 'public/models'
const manifest = parseAssemblyManifest(await readFile(args.manifest ?? 'catalog/manifest.json', 'utf8'))
const scan = await scanCatalogFolder(models, manifest)
const index = buildIndex(revisionId(manifest, scan.assets), scan.assets, (asset) => `${HOST}/models/${asset.file}`)
const built = buildCatalogFromIndex(index, manifest)
const catalog = Object.fromEntries(built.items.map((item) => [item.id, item]))
const prepared = {}
for (const item of built.items) {
  const asset = index.products.find((entry) => entry.url === item.glbUrl)
  prepared[item.id] = prepareProductAsset(scan.models[asset.file], item)
}
const context = {
  catalog, manifest,
  itemSnaps: Object.fromEntries(Object.entries(prepared).map(([id, entry]) => [id, entry.metadata.snaps])),
  itemRules: Object.fromEntries(Object.entries(prepared).map(([id, entry]) => [id, entry.metadata.rules])),
  itemSizes: Object.fromEntries(Object.entries(prepared).map(([id, entry]) => [id, entry.metadata.size])),
}

const { chromium } = await import('@playwright/test')
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
await mkdir(out, { recursive: true })
try {
  const page = await browser.newPage()
  await page.route(`${HOST}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname)
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: PAGE })
    if (path.startsWith('/three/')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(join(THREE_DIR, path.slice(7))) })
    if (path.startsWith('/models/')) return route.fulfill({ body: await readFile(join(models, path.slice(8))) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto(`${HOST}/`)
  await page.waitForFunction(() => globalThis.ready === true)
  const written = []
  const jobs = args.project
    ? [{ id: args.name ?? 'progetto', project: JSON.parse(await readFile(args.project, 'utf8')) }]
    : (manifest.samples ?? []).map((sample) => ({ id: sample.id, project: composeAssemblySample(sample, context).project }))
  for (const { id: sampleId, project } of jobs) {
    const sample = { id: sampleId }
    const items = project.items.map((item) => ({
      url: catalog[item.catalogId].glbUrl,
      color: item.catalogId.startsWith('ysi') ? '#8796a8' : '#e0894a',
      matrix: rootMatrix(item, prepared[item.catalogId], context.itemSizes[item.catalogId], mirrorScaleFor(item, context.itemRules), catalog[item.catalogId].scale ?? 1).toArray(),
    }))
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const item of project.items) {
      const size = context.itemSizes[item.catalogId]
      for (let i = 0; i < 3; i++) {
        const centre = i === 1 ? item.position[1] + size[1] / 2 : item.position[i]
        min[i] = Math.min(min[i], centre - 0.7); max[i] = Math.max(max[i], centre + 0.7)
      }
    }
    const centre = min.map((value, i) => (value + max[i]) / 2)
    const overview = await page.evaluate((input) => globalThis.renderAssembly(input), { items, view: { target: centre, eye: [centre[0] + (args.project ? -2.4 : 2.2), centre[1] + 1.4, centre[2] + 2.4] } })
    await writeFile(join(out, `${sample.id}-vista.png`), Buffer.from(overview.split(',')[1], 'base64'))
    written.push(`${sample.id}-vista.png`)
    // Section through every hole a part hangs on, once per hole column.
    const seen = new Set()
    const ends = (project.connections ?? []).flatMap((connection) => [[connection.sourceItemId, connection.sourcePointId], [connection.targetItemId, connection.targetPointId]])
    for (const [sideId, pointId] of ends) {
      const side = project.items.find((item) => item.id === sideId)
      const column = definitionFor(manifest, side.catalogId)?.holeColumns?.find((entry) => entry.sheet && pointId.startsWith(`${entry.id}-`))
      if (!column || seen.has(column.id) || side.mirrored) continue
      seen.add(column.id)
      const hole = snapsForItem(side, context.itemSnaps, context.itemRules).find((point) => point.id === pointId)
      const size = context.itemSizes[side.catalogId]
      const world = new Vector3(...hole.position).applyEuler(new Euler(...side.rotation)).add(new Vector3(side.position[0], side.position[1] + size[1] / 2, side.position[2]))
      const section = await page.evaluate((input) => globalThis.renderAssembly(input), { items, view: { section: world.y + 0.004, target: world.toArray(), half: 0.035, up: [-1, 0, 0] } })
      const name = `${sample.id}-sezione-${column.id}.png`
      await writeFile(join(out, name), Buffer.from(section.split(',')[1], 'base64'))
      written.push(name)
    }
  }
  console.log(`Immagini in ${out}: ${written.join(', ')}`)
} finally {
  await browser.close()
}
