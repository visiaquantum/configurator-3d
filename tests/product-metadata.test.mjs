import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createConfiguratorStore } from '../dist/configurator-3d.js'

const server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
let prepareProductAsset
try {
  const assets = await server.ssrLoadModule('/src/lib/scene/productAsset.ts')
  prepareProductAsset = assets.prepareProductAsset
} finally { await server.close() }

const catalog = { id: 'part', label: 'Part', glbUrl: '/part.glb' }
const snap = { id: 'face', kind: 'laterale', position: [0, 0, 0] }
const metadata = { size: [1, 1, 1], snaps: [snap], rules: [] }
const manifest = { version: 1, products: [{ catalogId: 'part', connectors: [{ id: 'seat', snapKind: 'laterale' }] }] }
const part = (id, extra = {}) => ({ id, catalogId: 'part', position: [0, 0, 0], rotation: [0, 0, 0], ...extra })
const legacy = () => ({ id: 'legacy', version: 1, enclosure: { glbUrl: '/van.glb' }, items: [
  part('a', { constraints: [{ type: 'snapToItem', target: 'b', point: 'face', targetPoint: 'face' }] }), part('b'),
] })
function setup() {
  const store = createConfiguratorStore()
  store.getState().setCatalog([catalog])
  return store
}
function model() {
  const root = new Group()
  const body = new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial())
  body.position.set(5, 4, 7)
  const marker = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
  marker.name = 'SNAP_TERRA'
  marker.position.set(5, 2, 7)
  const rule = new Group()
  rule.userData = { kind: 'rule', rule: 'mirror-pair', params: { axis: [0, 0, 1] } }
  rule.position.copy(body.position)
  root.add(body, marker, rule)
  return root
}

test('preparation centers the collider, scales snaps and hides markers without changing the loader model', () => {
  const source = model()
  const result = prepareProductAsset(source, { ...catalog, scale: 2 })
  assert.deepEqual(result.metadata.size, [4, 8, 12])
  assert.deepEqual(result.offset, [-10, -8, -14])
  assert.deepEqual(result.metadata.snaps[0].position, [0, -4, 0])
  assert.deepEqual(result.metadata.rules[0].position, [0, 0, 0])
  assert.deepEqual(result.metadata.rules[0].axis, [0, 0, 1])
  assert.equal(result.scene.children[1].visible, false)
  assert.equal(source.children[1].visible, true)
  assert.deepEqual(source.scale.toArray(), [1, 1, 1])
})

test('catalog collider and declared snap family keep their coordinate conventions', () => {
  const declared = { id: 'floor', kind: 'terra', position: [3, 2, 1] }
  const result = prepareProductAsset(model(), { ...catalog, scale: 2, size: [1, 2, 3], snapPoints: [declared] })
  assert.deepEqual(result.metadata.size, [2, 4, 6])
  assert.deepEqual(result.offset, [-10, -6, -14])
  assert.deepEqual(result.metadata.snaps, [declared])
  assert.notEqual(result.metadata.snaps[0], declared)
})

test('instances reuse preparation while geometry configuration and source changes invalidate it', () => {
  const source = model(), first = prepareProductAsset(source, catalog)
  assert.equal(prepareProductAsset(source, { ...catalog, label: 'Renamed' }), first)
  for (const change of [{ scale: 2 }, { size: [2, 2, 2] }, { snapPoints: [snap] }, { autoSnapGrid: true }, { glbUrl: '/new.glb' }]) {
    assert.notEqual(prepareProductAsset(source, { ...catalog, ...change }), first)
  }
  assert.notEqual(prepareProductAsset(model(), catalog), first)
  assert.throws(() => prepareProductAsset(new Group(), catalog), /geometria visibile/)
})

test('product hydration publishes an owned complete snapshot once and rejects obsolete loads', () => {
  const store = setup(), other = setup()
  let notifications = 0
  store.subscribe((state) => {
    notifications++
    assert.deepEqual(state.itemSizes.part, metadata.size)
    assert.deepEqual(state.itemSnaps.part, metadata.snaps)
    assert.deepEqual(state.itemRules.part, metadata.rules)
  })
  const original = store.getState().catalog.part
  store.getState().hydrateProduct(original, metadata)
  store.getState().hydrateProduct(original, metadata)
  other.getState().hydrateProduct(other.getState().catalog.part, metadata)
  assert.equal(notifications, 1)
  assert.notEqual(store.getState().itemSnaps.part, other.getState().itemSnaps.part)
  assert.notEqual(store.getState().itemSnaps.part, metadata.snaps)
  // Separate store so the snapshot assertions above remain specific to hydration.
  const obsolete = other.getState().catalog.part
  other.getState().setCatalog([{ ...catalog, scale: 2 }])
  other.getState().hydrateProduct(obsolete, metadata)
  assert.equal(other.getState().itemSizes.part, undefined)
})

for (const order of ['project-first', 'metadata-first', 'manifest-last']) test(`legacy migration is independent of React and load order: ${order}`, () => {
  const store = setup(), state = store.getState()
  if (order !== 'manifest-last') state.setAssemblyManifest(manifest)
  if (order !== 'metadata-first') state.setProject(legacy())
  state.hydrateProduct(store.getState().catalog.part, metadata)
  if (order === 'metadata-first') state.setProject(legacy())
  if (order === 'manifest-last') state.setAssemblyManifest(manifest)
  assert.equal(store.getState().project.connections.length, 1)
  assert.equal(store.getState().past.length, 0)
  assert.equal(store.getState().project.items[0].constraints[0].target, 'b')
})

test('last metadata publication includes complete migration in the same notification', () => {
  const store = setup(), state = store.getState()
  state.setAssemblyManifest(manifest)
  state.setProject(legacy())
  const seen = []
  store.subscribe((next) => seen.push(next))
  state.hydrateProduct(store.getState().catalog.part, metadata)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].project.connections.length, 1)
  assert.equal(seen[0].itemRules.part.length, 0)
})

test('legacy setters wait for rules, unresolved links stay pending, explicit empty graph stays empty', () => {
  const store = setup(), state = store.getState()
  state.setProject(legacy())
  state.setAssemblyManifest(manifest)
  state.setItemSnaps('part', [snap])
  assert.equal(store.getState().project.connections, undefined)
  state.setItemRules('part', [])
  assert.equal(store.getState().project.connections.length, 1)
  const invalid = legacy()
  invalid.items[0].constraints[0].point = 'missing'
  state.setProject(invalid)
  assert.equal(store.getState().project.connections, undefined)
  state.setProject({ ...legacy(), connections: [] })
  assert.deepEqual(store.getState().project.connections, [])
})

test('undo and redo resolve legacy snapshots using available metadata without adding history entries', () => {
  const store = setup(), state = store.getState()
  state.setProject(legacy())
  state.updateItem('a', { position: [1, 0, 0] })
  state.setAssemblyManifest(manifest)
  state.hydrateProduct(store.getState().catalog.part, metadata)
  assert.equal(store.getState().past.length, 1)
  state.undo()
  assert.equal(store.getState().project.connections.length, 1)
  assert.deepEqual(store.getState().project.items[0].position, [0, 0, 0])
  state.redo()
  assert.equal(store.getState().project.connections.length, 1)
  assert.deepEqual(store.getState().project.items[0].position, [1, 0, 0])
})

for (const path of ['MONTANTI/YSI12836.glb', 'KIT/KIT01.glb']) test(`real GLB preparation preserves marker IDs and scales coordinates: ${path}`, async () => {
  const bytes = await readFile(new URL(`../public/models/${path}`, import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const first = prepareProductAsset(gltf.scene, catalog)
  const scaled = prepareProductAsset(gltf.scene, { ...catalog, scale: 2 })
  assert.ok(first.metadata.snaps.length > 0)
  assert.equal(new Set(first.metadata.snaps.map((point) => point.id)).size, first.metadata.snaps.length)
  assert.deepEqual(scaled.metadata.size, first.metadata.size.map((value) => value * 2))
  // Auto-grid thresholds are physical metres: scaling can legitimately change
  // the set of detected holes. Explicit GLB markers must retain their identity.
  const markers = first.metadata.snaps.filter((point) => !point.id.startsWith('auto-grid-'))
  const scaledMarkers = scaled.metadata.snaps.filter((point) => !point.id.startsWith('auto-grid-'))
  assert.ok(markers.length > 0)
  assert.deepEqual(scaledMarkers.map((point) => point.id), markers.map((point) => point.id))
  for (let i = 0; i < markers.length; i++) {
    assert.deepEqual(scaledMarkers[i].position, markers[i].position.map((value) => value * 2))
  }
  assert.equal(prepareProductAsset(gltf.scene, catalog), first)
})
