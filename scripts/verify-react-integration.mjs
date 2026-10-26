import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Box3, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildProjectBom, hasBlockingIssues, hydrateItemSnapsAndHide, parseAssemblyManifest, parseCatalog, parseProject, validateConfiguration } from '../dist/configurator-3d.js'

const base = new URL('../examples/react-integration/public/', import.meta.url)
const json = async (path) => JSON.parse(await readFile(new URL(path, base), 'utf8'))
const catalog = parseCatalog(await json('catalog/catalog.json'))
const manifest = parseAssemblyManifest(await json('catalog/assembly-manifest.json'))
const { project, warnings } = parseProject(await json('catalog/project.json'), { catalog })
assert.deepEqual(warnings, [])
assert.deepEqual(manifest.products.map((product) => product.catalogId).sort(), catalog.map((product) => product.id).sort())

const loader = new GLTFLoader()
async function loadModel(path) {
  const bytes = await readFile(new URL(path, base))
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
}

const enclosure = await loadModel(project.enclosure.glbUrl)
assert.ok(!new Box3().setFromObject(enclosure.scene).isEmpty(), 'Vano GLB leggibile')
const itemSizes = {}
const itemSnaps = {}
for (const product of catalog) {
  const { scene } = await loadModel(product.glbUrl)
  hydrateItemSnapsAndHide(scene)
  scene.updateMatrixWorld(true)
  const bounds = new Box3()
  scene.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.computeBoundingBox()
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld))
  })
  const actual = bounds.getSize(new Vector3()).multiplyScalar(product.scale ?? 1).toArray()
  actual.forEach((size, axis) => assert.ok(Math.abs(size - product.size[axis] * (product.scale ?? 1)) < 0.002, `${product.id}: dimensione asse ${axis} coerente con il GLB (${size})`))
  itemSizes[product.id] = actual
  itemSnaps[product.id] = product.snapPoints
  const definition = manifest.products.find((entry) => entry.catalogId === product.id)
  for (const connector of definition.connectors) {
    assert.ok(product.snapPoints.some((point) => connector.snapId ? point.id === connector.snapId : point.kind === connector.snapKind), `${product.id}: punto dichiarato per ${connector.id}`)
    for (const compatible of connector.compatibleWith ?? []) {
      assert.ok(manifest.products.some((entry) => entry.connectors.some((other) => other.id === compatible)), `Connettore compatibile esistente: ${compatible}`)
    }
  }
}

const dimensions = project.enclosure.dimensions
const context = { itemSnaps, itemSizes, enclosureBounds: { min: [-dimensions[0] / 2, 0, -dimensions[2] / 2], max: [dimensions[0] / 2, dimensions[1], dimensions[2] / 2] } }
const byId = Object.fromEntries(catalog.map((product) => [product.id, product]))
const issues = validateConfiguration(project, byId, manifest, context)
assert.ok(!hasBlockingIssues(issues), JSON.stringify(issues))
assert.equal(project.items.length, 6)
assert.equal(project.connections.length, 8)
const bom = buildProjectBom(project, catalog, manifest)
assert.equal(bom.length, 3)
assert.ok(bom.every((line) => line.quantity === 2))

const displaced = structuredClone(project)
displaced.items.find((item) => item.id === 'shelf-top').position[0] += 0.02
assert.ok(hasBlockingIssues(validateConfiguration(displaced, byId, manifest, context)), 'Un ripiano spostato deve invalidare le connessioni')
const unjoined = { ...project, connections: project.connections.slice(0, 4) }
assert.ok(hasBlockingIssues(validateConfiguration(unjoined, byId, manifest, context)), 'Le connessioni mancanti devono segnalare interferenze')
console.log(`Integrazione verificata: ${catalog.length} prodotti, 4 GLB, 6 componenti, 8 connessioni e distinta 2+2+2. ${fileURLToPath(base)}`)
