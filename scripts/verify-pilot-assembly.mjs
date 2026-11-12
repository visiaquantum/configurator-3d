import {
  buildProjectBom,
  buildCatalogFromIndex,
  prepareProductAsset,
  hasBlockingIssues,
  positionForItemSnap,
  validateConfiguration,
  yawToMate,
  snapsForItem,
} from '../dist/configurator-3d.js'

import { runCatalogCheck } from './catalog/check.mjs'

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

const checked = await runCatalogCheck()
const manifest = checked.manifest
const built = buildCatalogFromIndex(checked.index, checked.manifest)
const ids = ['ysi02436', 'xds40231km02', 'ptbm31', 'kit01', 'xds40236km02', 'xha40100']
const catalog = Object.fromEntries(built.items.filter((item) => ids.includes(item.id)).map((item) => [item.id, item]))
const itemSnaps = Object.fromEntries(Object.values(catalog).map((item) => [item.id, prepareProductAsset(checked.scan.models[item.glbUrl], item).metadata.snaps]))
console.log('\n[pilot assembly] real YSI02436 + XDS40231KM02 assets')

const xdsSideHoles = itemSnaps.xds40231km02.filter((point) => point.kind === 'foro')
check('XDS automatic mounting-hole snaps are disabled', xdsSideHoles.length === 0)

// The production manifest covers the whole folder; the 1014 wall's seats are
// checked by tests/tasca-wall.test.mjs and by the catalogue check. Here only
// the KIT pilot products, which this script describes itself.
const pilotDefinitions = manifest.products.filter((product) => catalog[product.catalogId])
check('every pilot product is described by the manifest', Object.keys(catalog).every((id) => manifest.products.some((product) => product.catalogId === id)))
for (const definition of pilotDefinitions) {
  const product = catalog[definition.catalogId]
  const points = itemSnaps[product.id]
  for (const connector of definition.connectors) {
    const found = connector.snapId
      ? points.some((point) => point.id === connector.snapId)
      : points.some((point) => point.kind === connector.snapKind)
    check(`${definition.catalogId}:${connector.id} resolves to a GLB snap`, found)
  }
}
const itemRules = Object.fromEntries(Object.values(catalog).map((item) => [item.id, prepareProductAsset(checked.scan.models[item.glbUrl], item).metadata.rules]))
// This GLB authors its positive-width end; it seats on the mirrored side.
const uprightPoint = snapsForItem({ catalogId: 'ysi02436', mirrored: true }, itemSnaps, itemRules).find((point) => point.id === 'front-2')
const shelfPoint = itemSnaps.xds40231km02.find((point) => point.id === 'frontale')
check('the declared YSI hole exists in the GLB', Boolean(uprightPoint))
check('the declared XDS face exists in the GLB', Boolean(shelfPoint))

const upright = { id: 'upright-1', catalogId: 'ysi02436', mirrored: true, position: [0, 0, 0], rotation: [0, 0, 0] }
const targetWorld = [
  upright.position[0] + uprightPoint.position[0],
  upright.position[1] + catalog.ysi02436.size[1] / 2 + uprightPoint.position[1],
  upright.position[2] + uprightPoint.position[2],
]
const yaw = yawToMate(shelfPoint.normal, uprightPoint.normal, upright.rotation[1])
const shelfPosition = positionForItemSnap(shelfPoint.position, yaw, catalog.xds40231km02.size[1], targetWorld)
const shelf = { id: 'shelf-1', catalogId: 'xds40231km02', position: shelfPosition, rotation: [0, yaw, 0] }
const project = {
  id: 'pilot-ysi-xds', version: 1, enclosure: { glbUrl: '/enclosure.glb' }, items: [upright, shelf],
  connections: [{
    sourceItemId: shelf.id, sourceConnectorId: 'shelf-face', sourcePointId: shelfPoint.id,
    targetItemId: upright.id, targetConnectorId: 'side-front-hole', targetPointId: uprightPoint.id,
  }],
}
const context = { itemSnaps, itemRules }
const issues = validateConfiguration(project, catalog, manifest, context)
if (hasBlockingIssues(issues)) console.log('  detail', issues.map((issue) => issue.message).join(' | '))
check('resolved real-asset joint validates', !hasBlockingIssues(issues))
const bom = buildProjectBom(project, Object.values(catalog), manifest)
check('validated pilot BOM contains both products', bom.some((line) => line.code === 'YSI02436') && bom.some((line) => line.code === 'XDS40231KM02'))

const displaced = structuredClone(project)
displaced.items[1].position[0] += 0.02
check('a displaced real joint is rejected', hasBlockingIssues(validateConfiguration(displaced, catalog, manifest, context)))

console.log(`\n=== ${pass} pass, ${fail} fail ===`)
process.exit(fail ? 1 : 0)
