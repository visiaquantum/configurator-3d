// Compose KIT 01 out of single products and check the assembly holds.
//
// KIT01.glb ships the same frame as one pre-assembled body. Here the six
// members are placed one by one through the same math the drag uses
// (`yawToMate` + `positionForItemSnap`), so a wrong contact point, a wrong
// normal or a clearance that is too tight fails here instead of in the browser.
//
// The upright is YSI12836 (1.008 m); the kit's own YSI02436 (0.864 m) has no
// standalone GLB, so the composition is 14 cm taller than the kit by design.
// Everything else — shelf pitch, upright spacing, rail height — follows the kit.
import { readFileSync } from 'node:fs'
import { Box3, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  buildProjectBom,
  connectionsAtPose,
  extractAutoSnapGridFromObject,
  extractRulesFromObject,
  hasBlockingIssues,
  linkedPartners,
  hydrateItemSnapsAndHide,
  parseAssemblyManifest,
  positionForItemSnap,
  validateConfiguration,
  yawToMate,
} from '../dist/configurator-3d.js'

let pass = 0
let fail = 0
const check = (name, condition, detail) => {
  if (condition) {
    pass += 1
    console.log('  PASS', name)
  } else {
    fail += 1
    console.log('  FAIL', name, detail ? `\n        ${detail}` : '')
  }
}

const loadGlb = (path) => new Promise((resolve, reject) => {
  const data = readFileSync(path)
  new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '', resolve, reject)
})

function visibleBounds(root) {
  root.updateMatrixWorld(true)
  const bounds = new Box3()
  const meshBounds = new Box3()
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
    meshBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld)
    bounds.union(meshBounds)
  })
  return bounds
}

/** Match Item.tsx: GLB points move to the collider frame, catalog points don't. */
async function snapsFor(product) {
  const gltf = await loadGlb(`public${product.glbUrl}`)
  const root = gltf.scene.clone()
  const explicit = hydrateItemSnapsAndHide(root)
  const generated = extractAutoSnapGridFromObject(root, extractRulesFromObject(root).map((e) => e.extracted))
  const bounds = visibleBounds(root)
  const center = bounds.getCenter(new Vector3())
  return [
    ...[...explicit, ...generated].map((point) => ({
      ...point,
      position: [
        point.position[0] - center.x,
        point.position[1] - product.size[1] / 2 - bounds.min.y,
        point.position[2] - center.z,
      ],
    })),
    ...(product.snapPoints ?? []),
  ]
}

// Mirrors the `Orizzontali` / `Montanti` entries of src/App.tsx.
const catalog = {
  ysi12836: {
    id: 'ysi12836', label: 'Montante YSI 12836', glbUrl: '/models/MONTANTI/YSI12836.glb', size: [0.36, 1.008, 0.03],
    snapPoints: [
      { id: 'shelf-top', kind: 'laterale', position: [0, 0.108, 0.015], normal: [0, 0, -1] },
      { id: 'shelf-bottom', kind: 'laterale', position: [0, -0.144, 0.015], normal: [0, 0, -1] },
      { id: 'rail-xmax', kind: 'frontale', position: [0.155, -0.199, 0.0114], normal: [0, 0, -1] },
      { id: 'rail-xmin', kind: 'frontale', position: [-0.155, -0.199, 0.0114], normal: [0, 0, -1] },
    ],
  },
  xds40236km02: {
    id: 'xds40236km02', label: 'Orizzontale XDS 40236 KM02', glbUrl: '/models/ORIZZONTALI/XDS40236KM02.glb', size: [1.013, 0.07117, 0.357],
    snapPoints: [
      { id: 'end-a', kind: 'laterale', position: [-0.5065, 0, 0], normal: [-1, 0, 0] },
      { id: 'end-b', kind: 'laterale', position: [0.5065, 0, 0], normal: [1, 0, 0] },
    ],
  },
  xha40100: {
    id: 'xha40100', label: 'Traversa XHA 40100', glbUrl: '/models/ORIZZONTALI/XHA40100.glb', size: [0.05, 0.035, 1.00588],
    snapPoints: [
      { id: 'end-a', kind: 'frontale', position: [0, 0, 0.50294], normal: [0, 0, 1] },
      { id: 'end-b', kind: 'frontale', position: [0, 0, -0.50294], normal: [0, 0, -1] },
    ],
  },
}

const manifest = parseAssemblyManifest(readFileSync('public/catalog/assembly-manifest.json', 'utf8'))
const itemSnaps = {}
for (const product of Object.values(catalog)) itemSnaps[product.id] = await snapsFor(product)

console.log('\n[kit01 composition] 2 x YSI12836 + 2 x XDS40236KM02 + 2 x XHA40100')

for (const catalogId of Object.keys(catalog)) {
  const definition = manifest.products.find((p) => p.catalogId === catalogId)
  check(`${catalogId} is declared in the manifest`, Boolean(definition))
  for (const connector of definition?.connectors ?? []) {
    const found = connector.snapId
      ? itemSnaps[catalogId].some((point) => point.id === connector.snapId)
      : itemSnaps[catalogId].some((point) => point.kind === connector.snapKind)
    check(`${catalogId}:${connector.id} resolves to a snap point`, found)
  }
}

const pointOf = (catalogId, pointId) => itemSnaps[catalogId].find((point) => point.id === pointId)

/** World position of an item's snap point — same formula as validation.ts. */
function worldOf(item, pointId) {
  const point = pointOf(item.catalogId, pointId)
  const yaw = item.rotation[1]
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return [
    item.position[0] + point.position[0] * cos + point.position[2] * sin,
    item.position[1] + catalog[item.catalogId].size[1] / 2 + point.position[1],
    item.position[2] - point.position[0] * sin + point.position[2] * cos,
  ]
}

/** Place `catalogId` so `pointId` lands on `targetPointId` of `target`. */
function mate(id, catalogId, pointId, target, targetPointId) {
  const mine = pointOf(catalogId, pointId)
  const theirs = pointOf(target.catalogId, targetPointId)
  const yaw = yawToMate(mine.normal, theirs.normal, target.rotation[1])
  check(`${id} gets an orientation from ${targetPointId}`, yaw !== null)
  const position = positionForItemSnap(mine.position, yaw ?? 0, catalog[catalogId].size[1], worldOf(target, targetPointId))
  return { id, catalogId, position, rotation: [0, yaw ?? 0, 0] }
}

const uprightA = { id: 'upright-a', catalogId: 'ysi12836', position: [0, 0, 0.492], rotation: [0, 0, 0] }
const shelfTop = mate('shelf-top', 'xds40236km02', 'end-a', uprightA, 'shelf-top')
const shelfBottom = mate('shelf-bottom', 'xds40236km02', 'end-a', uprightA, 'shelf-bottom')
const railMax = mate('rail-max', 'xha40100', 'end-a', uprightA, 'rail-xmax')
const railMin = mate('rail-min', 'xha40100', 'end-a', uprightA, 'rail-xmin')
// The second upright closes the frame: it is placed against the top shelf's
// free end, exactly as dragging it in the editor would.
const uprightB = mate('upright-b', 'ysi12836', 'shelf-top', shelfTop, 'end-b')

const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol
check('shelves turn a quarter turn, like in the kit', near(shelfTop.rotation[1], Math.PI / 2) && near(shelfBottom.rotation[1], Math.PI / 2), `got ${shelfTop.rotation[1]} / ${shelfBottom.rotation[1]}`)
check('rails keep the frame orientation', near(railMax.rotation[1], 0) && near(railMin.rotation[1], 0), `got ${railMax.rotation[1]} / ${railMin.rotation[1]}`)
check('the second upright faces the first', near(Math.abs(uprightB.rotation[1]), Math.PI), `got ${uprightB.rotation[1]}`)
check('shelf pitch matches the kit (0.252 m)', near(shelfTop.position[1] - shelfBottom.position[1], 0.252, 2e-3), `got ${(shelfTop.position[1] - shelfBottom.position[1]).toFixed(4)}`)
check('uprights stand 1.013 m apart, outer face to outer face', near(Math.abs(uprightA.position[2] - uprightB.position[2]) + 0.03, 1.013, 2e-3), `got ${(Math.abs(uprightA.position[2] - uprightB.position[2]) + 0.03).toFixed(4)}`)
check('both uprights rest on the floor', near(uprightA.position[1], 0) && near(uprightB.position[1], 0), `got ${uprightB.position[1]}`)

const items = [uprightA, uprightB, shelfTop, shelfBottom, railMax, railMin]
const horizontals = [shelfTop, shelfBottom, railMax, railMin]
const heightOf = (placed) => catalog[placed.catalogId].size[1]
const contextFor = (present) => ({ items: present, itemSnaps, manifest, heightOf })

// Same order as the editor: the horizontals go against the first upright, then
// the second upright closes the frame and must bolt to all four in one move.
const firstPass = horizontals.flatMap((part) => connectionsAtPose(part, part, contextFor([uprightA, ...horizontals])))
check('each horizontal bolts to the first upright', firstPass.length === 4, `got ${firstPass.length}`)
const closing = connectionsAtPose(uprightB, uprightB, contextFor(items))
check('the closing upright bolts to all four horizontals at once', closing.length === 4, `got ${closing.length}`)
// Uprights are sinks in this graph, so the closed frame stays acyclic.
const connections = [...firstPass, ...closing]

// Joined parts share material on purpose: the push-out and the red tint must
// leave every joined pair alone, not just the one the positioning constraint
// names, or the frame is prised apart the moment anything moves.
const linked = linkedPartners(uprightB.id, items, connections)
check('the closing upright reads as linked to all four horizontals', linked.size === 4, `got ${[...linked].join(', ')}`)

const project = { id: 'kit01-composition', version: 1, enclosure: { glbUrl: '/enclosure.glb' }, items, connections }
const context = { itemSnaps }
const issues = validateConfiguration(project, catalog, manifest, context)
if (hasBlockingIssues(issues)) console.log('  detail', issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | '))
check('the composed frame validates', !hasBlockingIssues(issues))

const bom = buildProjectBom(project, Object.values(catalog), manifest)
const quantity = (code) => bom.find((line) => line.code === code)?.quantity ?? 0
check('BOM lists the six members', quantity('YSI12836') === 2 && quantity('XDS40236KM02') === 2 && quantity('XHA40100') === 2, JSON.stringify(bom.map((l) => `${l.code} x${l.quantity}`)))

const displaced = structuredClone(project)
displaced.items[2].position[0] += 0.02
check('a shelf pushed 2 cm out of line is rejected', hasBlockingIssues(validateConfiguration(displaced, catalog, manifest, context)))

// Recording only the joint the drag resolved would leave the closing upright
// buried in three parts with nothing declaring those overlaps legal — which is
// why it could never be put down.
const halfJoined = { ...project, connections: [...firstPass, closing[0]] }
check('dropping the far-end joints is reported as a collision', validateConfiguration(halfJoined, catalog, manifest, context).some((issue) => issue.code === 'collision'))

console.log(`\n=== ${pass} pass, ${fail} fail ===`)
process.exit(fail ? 1 : 0)
