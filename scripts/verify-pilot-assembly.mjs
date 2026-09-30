import { readFileSync } from 'node:fs'
import { Box3, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  buildProjectBom,
  extractAutoSnapGridFromObject,
  extractRulesFromObject,
  hasBlockingIssues,
  hydrateItemSnapsAndHide,
  parseAssemblyManifest,
  positionForItemSnap,
  validateConfiguration,
  yawToMate,
} from '../dist/configurator-3d.js'

let pass = 0
let fail = 0
const check = (name, condition) => {
  if (condition) {
    pass += 1
    console.log('  PASS', name)
  } else {
    fail += 1
    console.log('  FAIL', name)
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

/** Match Item.tsx: GLB coordinates become local to the catalog collider. */
async function snapsFromPilotGlb(path, catalogSize, autoSnapGrid, catalogSnapPoints = []) {
  const gltf = await loadGlb(path)
  const root = gltf.scene.clone()
  const explicit = hydrateItemSnapsAndHide(root)
  const modelRules = extractRulesFromObject(root).map((entry) => entry.extracted)
  const rules = autoSnapGrid
    ? [...modelRules.filter((rule) => rule.rule !== 'auto-snap-grid'), { rule: 'auto-snap-grid', position: [0, 0, 0], axis: [1, 0, 0], params: autoSnapGrid }]
    : modelRules
  const generated = extractAutoSnapGridFromObject(root, rules)
  const bounds = visibleBounds(root)
  const center = bounds.getCenter(new Vector3())
  return [...explicit, ...generated].map((point) => ({
    ...point,
    position: [
      point.position[0] - center.x,
      point.position[1] - catalogSize[1] / 2 - bounds.min.y,
      point.position[2] - center.z,
    ],
  })).concat(catalogSnapPoints)
}

const manifest = parseAssemblyManifest(readFileSync('public/catalog/assembly-manifest.json', 'utf8'))
const catalog = {
  ysi12836: { id: 'ysi12836', label: 'Montante YSI 12836', glbUrl: '/models/MONTANTI/YSI12836.glb', size: [0.36, 1.008, 0.03] },
  xds40231km02: { id: 'xds40231km02', label: 'Orizzontale XDS 40231 KM02', glbUrl: '/models/ORIZZONTALI/XDS40231KM02.glb', size: [1.011, 0.07, 0.307] },
  ptbm31: { id: 'ptbm31', label: 'Accessorio PTBM-31', glbUrl: '/models/ACCESSORI/PTBM-31.glb', size: [0.31, 0.14, 0.09] },
  kit01: { id: 'kit01', label: 'Kit 01', glbUrl: '/models/KIT/KIT01.glb', size: [0.36, 0.864, 1.014] },
  // Kit-01 members: this script asserts the manifest never names a product the
  // catalogue lacks, so they belong here too. Their joint geometry is covered
  // by verify-kit01-composition.mjs.
  xds40236km02: { id: 'xds40236km02', label: 'Orizzontale XDS 40236 KM02', glbUrl: '/models/ORIZZONTALI/XDS40236KM02.glb', size: [1.013, 0.07117, 0.357] },
  xha40100: { id: 'xha40100', label: 'Traversa XHA 40100', glbUrl: '/models/ORIZZONTALI/XHA40100.glb', size: [0.05, 0.035, 1.00588] },
}

console.log('\n[pilot assembly] real YSI12836 + XDS40231KM02 assets')
const itemSnaps = {
  ysi12836: await snapsFromPilotGlb('public/models/MONTANTI/YSI12836.glb', catalog.ysi12836.size),
  xds40231km02: await snapsFromPilotGlb('public/models/ORIZZONTALI/XDS40231KM02.glb', catalog.xds40231km02.size),
}

const xdsSideHoles = itemSnaps.xds40231km02.filter((point) => point.kind === 'foro')
check('XDS automatic mounting-hole snaps are disabled', xdsSideHoles.length === 0)

check('every manifest product belongs to the pilot catalog', manifest.products.every((product) => catalog[product.catalogId]))
for (const definition of manifest.products) {
  const product = catalog[definition.catalogId]
  const path = `public${product.glbUrl}`
  const points = definition.catalogId in itemSnaps
    ? itemSnaps[definition.catalogId]
    : await snapsFromPilotGlb(path, product.size)
  for (const connector of definition.connectors) {
    const found = connector.snapId
      ? points.some((point) => point.id === connector.snapId)
      : points.some((point) => point.kind === connector.snapKind)
    check(`${definition.catalogId}:${connector.id} resolves to a GLB snap`, found)
  }
}
const uprightPoint = itemSnaps.ysi12836.find((point) => point.id === 'auto-grid-xmin-r0-c1')
const shelfPoint = itemSnaps.xds40231km02.find((point) => point.id === 'frontale')
check('the declared YSI hole exists in the GLB', Boolean(uprightPoint))
check('the declared XDS face exists in the GLB', Boolean(shelfPoint))

const upright = { id: 'upright-1', catalogId: 'ysi12836', position: [0, 0, 0], rotation: [0, 0, 0] }
const targetWorld = [
  upright.position[0] + uprightPoint.position[0],
  upright.position[1] + catalog.ysi12836.size[1] / 2 + uprightPoint.position[1],
  upright.position[2] + uprightPoint.position[2],
]
const yaw = yawToMate(shelfPoint.normal, uprightPoint.normal, upright.rotation[1])
const shelfPosition = positionForItemSnap(shelfPoint.position, yaw, catalog.xds40231km02.size[1], targetWorld)
const shelf = { id: 'shelf-1', catalogId: 'xds40231km02', position: shelfPosition, rotation: [0, yaw, 0] }
const project = {
  id: 'pilot-ysi-xds', version: 1, enclosure: { glbUrl: '/enclosure.glb' }, items: [upright, shelf],
  connections: [{
    sourceItemId: shelf.id, sourceConnectorId: 'shelf-face', sourcePointId: shelfPoint.id,
    targetItemId: upright.id, targetConnectorId: 'upright-holes', targetPointId: uprightPoint.id,
  }],
}
const context = { itemSnaps }
const issues = validateConfiguration(project, catalog, manifest, context)
if (hasBlockingIssues(issues)) console.log('  detail', issues.map((issue) => issue.message).join(' | '))
check('resolved real-asset joint validates', !hasBlockingIssues(issues))
const bom = buildProjectBom(project, Object.values(catalog), manifest)
check('validated pilot BOM contains both products', bom.some((line) => line.code === 'YSI12836') && bom.some((line) => line.code === 'XDS40231KM02'))

const displaced = structuredClone(project)
displaced.items[1].position[0] += 0.02
check('a displaced real joint is rejected', hasBlockingIssues(validateConfiguration(displaced, catalog, manifest, context)))

console.log(`\n=== ${pass} pass, ${fail} fail ===`)
process.exit(fail ? 1 : 0)
