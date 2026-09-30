import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, MeshBasicMaterial, BoxGeometry, BufferGeometry, Float32BufferAttribute, Shape, Path, ShapeGeometry, Vector3, Euler } from 'three'
import {
  createConfiguratorStore, parseProject, serializeProject, parseCatalog,
  parseAssemblyManifest, validateConfiguration, connectionsAtPose,
  connectorForSnap, connectorsCanMate, inferLegacyConnections,
  extractAutoSnapGridFromObject, AUTO_SNAP_GRID_RULE, configurationStatus,
  positionForItemSnap, exportProjectPDF, exportSceneGLB,
} from '../dist/configurator-3d.js'

const item = (id, extra = {}) => ({ id, catalogId: 'part', position: [0, 0, 0], rotation: [0, 0, 0], ...extra })
const project = (items = [], extra = {}) => ({ id: 'regression', version: 1, enclosure: { glbUrl: '/van.glb', scale: 10 }, items, connections: [], ...extra })
const catalog = { part: { id: 'part', label: 'Part', glbUrl: '/part.glb', size: [1, 1, 1] } }
const bounds = { min: [-10, -10, -10], max: [10, 10, 10] }
const connection = (source = 'a', target = 'b') => ({ sourceItemId: source, sourcePointId: 'face', sourceConnectorId: 'seat', targetItemId: target, targetPointId: 'face', targetConnectorId: 'seat' })
const manifest = parseAssemblyManifest({ version: 1, products: [{ catalogId: 'part', connectors: [{ id: 'seat', snapKind: 'laterale', snapTolerance: 0.001 }] }] })
const snap = { id: 'face', kind: 'laterale', position: [0, 0, 0] }
const context = { itemSnaps: { part: [snap] }, enclosureBounds: bounds }
const errors = (p, cats = catalog, m = manifest, ctx = context) => validateConfiguration(p, cats, m, ctx).filter((issue) => issue.level === 'error')

// Keep models apart vertically without separating their snap positions.
const joined = () => project([item('a'), item('b', { position: [0, 0, 0], catalogId: 'other' })], { connections: [connection()] })
const pairCatalog = { ...catalog, other: { ...catalog.part, id: 'other' } }
const pairManifest = () => parseAssemblyManifest({ version: 1, products: [manifest.products[0], { catalogId: 'other', connectors: [{ id: 'seat', snapKind: 'laterale', snapTolerance: 0.01 }] }] })
const pairContext = { itemSnaps: { part: [snap], other: [snap] }, enclosureBounds: bounds }

for (const [name, mutate] of [
  ['duplicate item IDs', (p) => { p.items.push(item('a')) }],
  ['nonpositive enclosure scale', (p) => { p.enclosure.scale = 0 }],
  ['invalid locked axis', (p) => { p.items[0].constraints = [{ type: 'lockAxis' }] }],
  ['incomplete legacy link', (p) => { p.items[0].constraints = [{ type: 'snapToItem', target: 'b' }] }],
  ['future project version', (p) => { p.version = 999 }],
  ['non-numeric project version', (p) => { p.version = '1' }],
]) test(`import rejects ${name}`, () => {
  const p = project([item('a')]); mutate(p); assert.throws(() => parseProject(p))
})

test('serialization preserves scale, constraints and connection transforms', () => {
  const p = project([item('a'), item('b', { constraints: [{ type: 'lockAxis', axis: 'z' }] })], { connections: [{ ...connection(), resolvedTransform: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3] } }] })
  assert.deepEqual(parseProject(serializeProject(p)).project, p)
})

test('catalog rejects future versions, duplicate products, duplicate snaps and inverted hole ranges', () => {
  assert.throws(() => parseCatalog({ version: 999, items: [] }))
  assert.throws(() => parseCatalog([catalog.part, catalog.part]))
  assert.throws(() => parseCatalog([{ ...catalog.part, snapPoints: [snap, snap] }]))
  assert.throws(() => parseCatalog([{ ...catalog.part, autoSnapGrid: { minHoleSize: 0.03, maxHoleSize: 0.01 } }]))
})

test('manifest rejects a future version and ambiguous product IDs', () => {
  assert.throws(() => parseAssemblyManifest({ ...manifest, version: 999 }))
  assert.throws(() => parseAssemblyManifest({ version: 1, products: [manifest.products[0], manifest.products[0]] }))
})

test('new configurators own independent project, history and live item registries', () => {
  const a = createConfiguratorStore(), b = createConfiguratorStore()
  a.getState().setProject(project([item('same')])); b.getState().setProject(project([item('same')]))
  a.getState().updateItem('same', { position: [3, 0, 0] })
  a.getState().itemRegistry.set('same', { group: new Group() })
  assert.equal(b.getState().project.items[0].position[0], 0)
  assert.equal(b.getState().past.length, 0)
  assert.equal(b.getState().itemRegistry.size, 0)
})

test('reset using the same enclosure preserves anchors and floor bounds', () => {
  const store = createConfiguratorStore()
  store.getState().setProject(project())
  store.getState().setRuntimeAnchors([{ id: 'floor', position: [0, 0.038, 0] }])
  store.getState().setEnclosureBBox(bounds); store.getState().setInteriorBBox(bounds)
  store.getState().setProject(project())
  assert.deepEqual(store.getState().enclosureBBox, bounds)
  assert.equal(store.getState().runtimeAnchors[0].id, 'floor')
  store.getState().setProject(project([], { enclosure: { glbUrl: '/another.glb' } }))
  assert.equal(store.getState().enclosureBBox, null)
  assert.deepEqual(store.getState().runtimeAnchors, [])
})

test('readonly blocks mutation, undo, redo and mirror creation', () => {
  const store = createConfiguratorStore(); store.getState().setProject(project([item('a')]))
  store.getState().updateItem('a', { position: [1, 0, 0] }); store.getState().undo()
  store.getState().setReadOnly(true)
  const before = structuredClone(store.getState().project)
  store.getState().redo(); store.getState().updateItem('a', { position: [2, 0, 0] })
  store.getState().removeItem('a'); store.getState().createMirrorPair('a', item('twin'), 1)
  store.getState().addItem(item('other')); store.getState().undo()
  assert.deepEqual(store.getState().project, before)
})

test('locked items and axes are enforced by the command API', () => {
  const store = createConfiguratorStore(); store.getState().setProject(project([item('a', { locked: true }), item('b', { constraints: [{ type: 'lockAxis', axis: 'x' }] })]))
  store.getState().updateItem('a', { position: [1, 0, 0] }); store.getState().removeItem('a')
  store.getState().updateItem('b', { position: [1, 0, 0] })
  assert.equal(store.getState().past.length, 0)
  store.getState().updateItem('b', { position: [0, 2, 0] })
  assert.deepEqual(store.getState().project.items[1].position, [0, 2, 0])
  store.getState().updateItem('a', { locked: false }); store.getState().removeItem('a')
  assert.equal(store.getState().project.items.length, 1)
})

test('removing a mirrored twin also removes its joints and survivor constraints', () => {
  const store = createConfiguratorStore(); store.getState().setProject(project([item('a'), item('child')]))
  store.getState().createMirrorPair('a', item('twin', { mirrored: true }), 1)
  store.getState().commitAssembly([], [connection('child', 'twin')])
  store.getState().removeMirrorPair('a')
  assert.equal(store.getState().project.items.length, 2)
  assert.deepEqual(store.getState().project.connections, [])
  assert.ok(store.getState().project.items.every((it) => !it.constraints?.some((c) => c.target === 'twin')))
  store.getState().undo(); assert.equal(store.getState().project.items.length, 3)
  assert.equal(store.getState().project.connections.length, 1)
})

test('normal deletion cleans legacy followers even without an explicit graph', () => {
  const store = createConfiguratorStore()
  store.getState().setProject(project([item('a'), item('b', { constraints: [{ type: 'snapToItem', target: 'a', point: 'face', targetPoint: 'face' }] })], { connections: undefined }))
  store.getState().removeItem('a')
  assert.deepEqual(store.getState().project.items[0].constraints, [])
})

test('exported project snapshots cannot mutate state or undo history', () => {
  const store = createConfiguratorStore(); store.getState().setProject(project([item('a')]))
  const output = store.getState().exportProject(); output.items[0].position[0] = 100
  assert.equal(store.getState().project.items[0].position[0], 0)
})

test('invalid updates do not change state or create history', () => {
  const store = createConfiguratorStore(); store.getState().setProject(project([item('a')]))
  assert.throws(() => store.getState().updateItems([{ id: 'a', patch: { position: [NaN, 0, 0] } }]))
  assert.equal(store.getState().past.length, 0)
  assert.throws(() => store.getState().updateItem('a', { id: 'changed' }))
})

test('changing a catalog model invalidates only its hydrated metadata', () => {
  const store = createConfiguratorStore(); store.getState().setCatalog([catalog.part, pairCatalog.other])
  store.getState().setItemSnaps('part', [snap]); store.getState().setItemSnaps('other', [snap])
  store.getState().setItemSize('part', [1, 1, 1])
  store.getState().setCatalog([{ ...catalog.part, scale: 2 }, pairCatalog.other])
  assert.equal(store.getState().itemSnaps.part, undefined)
  assert.equal(store.getState().itemSizes.part, undefined)
  assert.deepEqual(store.getState().itemSnaps.other, [snap])
})

test('missing point IDs are blocking even for nonintersecting parts', () => {
  const p = project([item('a'), item('b', { position: [4, 0, 0] })], { connections: [{ ...connection(), sourcePointId: 'missing' }] })
  assert.ok(errors(p).some((issue) => issue.message.includes('snap assente')))
})

test('a connector cannot claim a point outside its declared interface', () => {
  const wrong = { id: 'fixed', snapId: 'different', compatibleWith: ['laterale'] }
  assert.equal(connectorsCanMate(wrong, snap, manifest.products[0].connectors[0], snap), false)
  assert.equal(connectorForSnap({ connectors: [wrong] }, snap), undefined)
})

test('validation and discovery both respect the stricter tolerance', () => {
  const p = joined(); p.items[1].position[0] = 0.005
  assert.ok(errors(p, pairCatalog, pairManifest(), pairContext).some((issue) => issue.message.includes('Snap non allineati')))
  assert.deepEqual(connectionsAtPose(p.items[0], p.items[0], { items: p.items, itemSnaps: pairContext.itemSnaps, manifest: pairManifest(), heightOf: () => 1 }), [])
})

test('same-facing normals are rejected by validation and connection discovery', () => {
  const p = joined(); const ctx = { ...pairContext, itemSnaps: { part: [{ ...snap, normal: [1, 0, 0] }], other: [{ ...snap, normal: [1, 0, 0] }] } }
  assert.ok(errors(p, pairCatalog, pairManifest(), ctx).some((issue) => issue.message.includes('Normali')))
  assert.deepEqual(connectionsAtPose(p.items[0], p.items[0], { items: p.items, itemSnaps: ctx.itemSnaps, manifest: pairManifest(), heightOf: () => 1 }), [])
})

test('fallback collision dimensions apply catalog scale exactly once', () => {
  const p = project([item('a')])
  const ctx = { ...context, enclosureBounds: { min: [-1.05, 0, -1.05], max: [1.05, 2.1, 1.05] } }
  assert.deepEqual(errors(p, { part: { ...catalog.part, scale: 2 } }, null, ctx), [])
})

test('runtime body height is the snap datum, not a partial collider height', () => {
  const p = joined()
  const m = pairManifest(); m.products[0].colliders = [{ id: 'small', center: [0, 0, 0], size: [0.1, 0.1, 0.1] }]
  const issues = errors(p, pairCatalog, m, { ...pairContext, itemSizes: { part: [1, 1, 1], other: [1, 1, 1] } })
  assert.ok(!issues.some((issue) => issue.message.includes('Snap non allineati')))
})

test('pitch and roll affect containment and snap coordinates', () => {
  const p = project([item('a', { rotation: [0, 0, Math.PI / 2] })])
  const cats = { part: { ...catalog.part, size: [0.1, 2, 0.1] } }
  const ctx = { ...context, enclosureBounds: { min: [-0.2, -2, -0.2], max: [0.2, 3, 0.2] } }
  assert.ok(errors(p, cats, null, ctx).some((issue) => issue.code === 'out-of-bounds'))
  const rotation = [0.4, 0.6, 0.8], point = [0.1, 0.3, 0.2], target = [1, 2, 3]
  const base = positionForItemSnap(point, rotation, 2, target)
  const world = new Vector3(...point).applyEuler(new Euler(...rotation)).add(new Vector3(base[0], base[1] + 1, base[2]))
  assert.ok(world.distanceTo(new Vector3(...target)) < 1e-10)
})

test('unknown catalog and manifest products cannot be certified', () => {
  assert.ok(errors(project([item('a')]), {}).some((issue) => issue.code === 'unknown-product'))
  assert.ok(errors(project([item('a')]), catalog, { version: 1, products: [] }).some((issue) => issue.code === 'unknown-product'))
})

test('legacy inference is repeatable once every asset has hydrated', () => {
  const p = project([item('a'), item('b', { position: [4, 0, 0], catalogId: 'other', constraints: [{ type: 'snapToItem', target: 'a', point: 'face', targetPoint: 'face' }] })], { connections: undefined })
  assert.equal(inferLegacyConnections(p, pairManifest(), { part: [snap] }, {}).length, 0)
  assert.equal(inferLegacyConnections(p, pairManifest(), pairContext.itemSnaps, {}).length, 1)
})

const autoRules = [{ rule: AUTO_SNAP_GRID_RULE, position: [0, 0, 0], axis: [0, 0, 1], params: { normals: [[0, 0, 1]], minHoleSize: 0.004, maxHoleSize: 0.03 } }]

test('a solid small triangle is not a drilling hole', () => {
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3))
  assert.deepEqual(extractAutoSnapGridFromObject(new Mesh(geometry), autoRules), [])
})

test('a closed inner contour is detected, a hidden ancestor is ignored', () => {
  const shape = new Shape(); shape.moveTo(-0.1, -0.1); shape.lineTo(0.1, -0.1); shape.lineTo(0.1, 0.1); shape.lineTo(-0.1, 0.1); shape.closePath()
  const hole = new Path(); hole.moveTo(-0.005, -0.005); hole.lineTo(-0.005, 0.005); hole.lineTo(0.005, 0.005); hole.lineTo(0.005, -0.005); hole.closePath(); shape.holes.push(hole)
  const root = new Group(); root.add(new Mesh(new ShapeGeometry(shape)))
  const points = extractAutoSnapGridFromObject(root, autoRules)
  assert.equal(points.length, 1); assert.ok(Math.hypot(...points[0].position) < 1e-8)
  root.visible = false; assert.deepEqual(extractAutoSnapGridFromObject(root, autoRules), [])
})

test('readiness never certifies absent manifests, unloaded models or failed assets', () => {
  const store = createConfiguratorStore(); store.getState().setProject(project())
  assert.equal(configurationStatus(store.getState()).ready, false)
  store.setState({ captureRefs: {}, enclosureBBox: bounds })
  assert.equal(configurationStatus(store.getState()).ready, true)
  assert.equal(configurationStatus(store.getState()).technical, false)
  store.getState().setAssemblyManifest(manifest)
  assert.equal(configurationStatus(store.getState()).technical, true)
  store.getState().setAssetError('enclosure', 'failed')
  assert.equal(configurationStatus(store.getState()).ready, false)
})

test('host telemetry exceptions never break an editing command', () => {
  const store = createConfiguratorStore(); store.getState().setTelemetryListener(() => { throw new Error('host failure') })
  assert.doesNotThrow(() => store.getState().reportTelemetry({ type: 'export', outcome: 'success' }))
})

test('PDF pagination wraps long metadata and BOM descriptions', async () => {
  const parts = Array.from({ length: 80 }, (_, index) => ({ ...catalog.part, id: `code-${index}`, label: 'Descrizione componente molto lunga '.repeat(8) }))
  const p = project(parts.map((part, index) => item(`id-${index}`, { catalogId: part.id })), { metadata: { name: 'Titolo lungo '.repeat(30), customer: 'Cliente '.repeat(60) } })
  const blob = await exportProjectPDF({ project: p, catalog: parts, date: new Date('2026-09-30T12:00:00Z') })
  const content = await blob.text()
  assert.ok(content.startsWith('%PDF'))
  assert.ok((content.match(/\/Type \/Page\b/g) ?? []).length > 5)
  assert.ok(content.includes('verifica tecnica non eseguita'))
})

test('GLB export excludes descendant helpers and preserves world transforms and materials', async () => {
  // GLTFExporter uses the browser FileReader interface for binary buffers.
  const previous = globalThis.FileReader
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.() }) }
    readAsDataURL(blob) { blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onloadend?.() }) }
  }
  try {
    const parent = new Group(); parent.position.x = 3
    const root = new Group(); root.name = 'product'; root.position.x = 2; parent.add(root)
    const body = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ transparent: true, opacity: 0.5 })); body.name = 'body'; root.add(body)
    const helper = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); helper.name = 'collision-helper'; helper.userData.configuratorHelper = true; root.add(helper)
    const blob = await exportSceneGLB([root]); const buffer = await blob.arrayBuffer(); const view = new DataView(buffer)
    assert.equal(view.getUint32(0, true), 0x46546c67)
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))))
    assert.ok(!json.nodes.some((node) => node.name === 'collision-helper'))
    assert.deepEqual(json.nodes.find((node) => node.name === 'product').matrix.slice(12, 15), [5, 0, 0])
    assert.equal(body.material.opacity, 0.5); assert.equal(root.children.length, 2)
  } finally { globalThis.FileReader = previous }
})
