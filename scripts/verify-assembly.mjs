import {
  hasBlockingIssues,
  parseAssemblyManifest,
  validateConfiguration,
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

const manifest = parseAssemblyManifest({
  version: 1,
  products: [
    {
      catalogId: 'upright',
      connectors: [{
        id: 'holes', snapKind: 'foro', capacity: 1, insertionDepth: 0.05, insertionAxis: [1, 0, 0],
        clearance: [{ id: 'hole-seat', center: [0, 0, 0], size: [0.1, 0.6, 0.12] }],
      }],
      colliders: [{ id: 'body', center: [0, 0, 0], size: [0.1, 1, 0.1] }],
    },
    {
      catalogId: 'shelf',
      connectors: [{
        id: 'face', snapKind: 'frontale', compatibleWith: ['holes'], capacity: 1, insertionDepth: 0.05, insertionAxis: [-1, 0, 0],
        clearance: [{ id: 'tab', center: [0, 0, 0], size: [0.1, 0.6, 0.12] }],
      }],
      colliders: [{ id: 'body', center: [0, 0, 0], size: [0.1, 0.1, 0.5] }],
    },
  ],
})

const catalog = {
  upright: { id: 'upright', label: 'Upright', glbUrl: '/upright.glb', size: [0.1, 1, 0.1] },
  shelf: { id: 'shelf', label: 'Shelf', glbUrl: '/shelf.glb', size: [0.1, 0.1, 0.5] },
}

const base = {
  id: 'test',
  version: 1,
  enclosure: { glbUrl: '/enclosure.glb' },
  items: [
    { id: 'upright-1', catalogId: 'upright', position: [0, 0, 0], rotation: [0, 0, 0] },
    { id: 'shelf-1', catalogId: 'shelf', position: [0.07, 0.2, 0], rotation: [0, 0, 0] },
  ],
  connections: [
    {
      sourceItemId: 'shelf-1', sourceConnectorId: 'face', sourcePointId: 'frontale',
      targetItemId: 'upright-1', targetConnectorId: 'holes', targetPointId: 'foro-r1-c1',
    },
  ],
}

const snapContext = {
  itemSnaps: {
    upright: [{ id: 'foro-r1-c1', kind: 'foro', position: [0.07, 0, 0], normal: [1, 0, 0] }],
    shelf: [{ id: 'frontale', kind: 'frontale', position: [0, 0.25, 0], normal: [-1, 0, 0] }],
  },
}

console.log('\n[assembly] contextual collision validation')
check('manifest parses', manifest.products.length === 2)
check('declared clearance-zone insertion is valid', !hasBlockingIssues(validateConfiguration(base, catalog, manifest, snapContext)))

const tooDeep = structuredClone(base)
tooDeep.items[1].position[0] = 0.01
check('excess penetration is rejected', hasBlockingIssues(validateConfiguration(tooDeep, catalog, manifest, snapContext)))

const occupied = structuredClone(base)
occupied.connections.push(structuredClone(base.connections[0]))
check('occupied snap is rejected', validateConfiguration(occupied, catalog, manifest, snapContext).some((issue) => issue.code === 'connector-capacity'))

const unaligned = structuredClone(base)
unaligned.items[1].position[2] = 0.02
check('misaligned snap is rejected', validateConfiguration(unaligned, catalog, manifest, snapContext).some((issue) => issue.message.startsWith('Snap non allineati')))

const cyclic = structuredClone(base)
cyclic.connections.push({
  sourceItemId: 'upright-1', sourceConnectorId: 'holes', sourcePointId: 'foro-r1-c1',
  targetItemId: 'shelf-1', targetConnectorId: 'face', targetPointId: 'frontale',
})
check('cyclic assembly is rejected', validateConfiguration(cyclic, catalog, manifest, snapContext).some((issue) => issue.message === 'Connessioni cicliche non consentite'))

console.log(`\n=== ${pass} pass, ${fail} fail ===`)
process.exit(fail ? 1 : 0)
