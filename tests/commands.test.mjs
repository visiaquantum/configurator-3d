import test from 'node:test'
import assert from 'node:assert/strict'
import { Group } from 'three'
import { createServer } from 'vite'
import { createConfiguratorStore, connectorsCanMate, attachmentPoints, parseAssemblyManifest } from '../dist/configurator-3d.js'

// Domain commands and rules run against a plain store: no React, no WebGL.
const server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
let commands, shortcuts, spacing, movement, registry, liveDrag
try {
  commands = await server.ssrLoadModule('/src/lib/scene/commands.ts')
  shortcuts = await server.ssrLoadModule('/src/lib/state/shortcuts.ts')
  spacing = await server.ssrLoadModule('/src/lib/assembly/pairSpacing.ts')
  movement = await server.ssrLoadModule('/src/lib/scene/itemMovement.ts')
  registry = await server.ssrLoadModule('/src/lib/scene/itemRegistry.ts')
  liveDrag = await server.ssrLoadModule('/src/lib/scene/liveDrag.ts')
} finally { await server.close() }

const part = (id, position = [0, 0, 0], extra = {}) => ({ id, catalogId: 'part', position, rotation: [0, 0, 0], ...extra })
const joint = (a, b) => ({ sourceItemId: a, targetItemId: b, sourcePointId: 'left', targetPointId: 'right', sourceConnectorId: 'left', targetConnectorId: 'right' })
function setup(items, connections = [], anchors) {
  const store = createConfiguratorStore()
  store.getState().setProject({ id: 'cmd', version: 1, enclosure: { glbUrl: '/van.glb', ...(anchors ? { anchors } : {}) }, items, connections })
  store.getState().setCatalog([{ id: 'part', label: 'Part', glbUrl: '/part.glb', size: [1, 1, 1] }])
  store.getState().setItemSize('part', [1, 1, 1])
  for (const item of items) store.getState().itemRegistry.set(item.id, { id: item.id, group: new Group(), localCorners: registry.buildLocalCorners([1, 1, 1]) })
  movement.restoreLiveItems(store.getState())
  return store
}

test('the key map maps each shortcut to one store command and stays out of attachment and walk mode', () => {
  const key = (k, mod = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...mod })
  const idle = { attachment: null, walkMode: false, selectedId: 'a' }
  assert.equal(shortcuts.shortcutFor(key('z', { metaKey: true }), idle).preventDefault, true)
  assert.equal(shortcuts.shortcutFor(key('t', { ctrlKey: true }), idle), null)
  assert.equal(shortcuts.shortcutFor(key('w'), { ...idle, walkMode: true }), null)
  assert.equal(shortcuts.shortcutFor(key('Delete'), { ...idle, selectedId: null }), null)
  assert.equal(shortcuts.shortcutFor(key('r'), { ...idle, attachment: { stage: 'source' } }), null)
  const store = setup([part('a'), part('b', [3, 0, 0])])
  store.getState().select('a')
  shortcuts.shortcutFor(key('Backspace'), store.getState()).run(store.getState())
  assert.deepEqual(store.getState().project.items.map((it) => it.id), ['b'])
  shortcuts.shortcutFor(key('Z', { ctrlKey: true }), store.getState()).run(store.getState())
  assert.equal(store.getState().project.items.length, 2)
})

test('inspector rotation of a free part follows the gesture rules: push-out, one undo entry', () => {
  const store = setup([part('a'), part('b', [1.2, 0, 0])])
  // A long part turned towards its neighbour is pushed clear of it, as on a gesture release.
  store.getState().itemRegistry.get('a').localCorners = registry.buildLocalCorners([1, 1, 3])
  movement.rotateAssembly(store, 'a', Math.PI / 2)
  const a = store.getState().project.items[0]
  assert.deepEqual(a.rotation, [0, Math.PI / 2, 0])
  assert.ok(a.position[0] <= 1.2 - 0.5 - 1.5 + 1e-6, `pushed to ${a.position[0]}`)
  assert.equal(store.getState().past.length, 1)
  // Joined parts still turn rigidly about the part acted on.
  const frame = setup([part('a'), part('b', [1, 0, 0])], [joint('b', 'a')])
  movement.rotateAssembly(frame, 'a', Math.PI / 2)
  const b = frame.getState().project.items[1]
  assert.ok(Math.abs(b.position[0]) < 1e-9 && Math.abs(b.position[2] + 1) < 1e-9)
  assert.equal(frame.getState().project.connections.length, 1)
})

test('adding, anchoring and unjoining are plain store commands with one undo entry each', () => {
  const store = setup([part('a'), part('b', [1, 0, 0])], [joint('b', 'a')], [{ id: 'bay', position: [5, 0, 5] }])
  const id = commands.addItemToScene(store, { id: 'part', label: 'Part', glbUrl: '/part.glb', size: [1, 1, 1] })
  assert.deepEqual(store.getState().project.items.find((it) => it.id === id).position, [2.05, 0, 0])
  assert.equal(store.getState().selectedId, id)
  commands.snapAssemblyToAnchor(store, 'a', 'bay')
  assert.deepEqual(store.getState().project.items.slice(0, 2).map((it) => it.position), [[5, 0, 5], [6, 0, 5]])
  assert.equal(store.getState().project.items[0].constraints.at(-1).target, 'bay')
  commands.unjoinItem(store, 'b')
  assert.deepEqual(store.getState().project.connections, [])
  assert.equal(store.getState().past.length, 3)
})

test('mirror pair spacing: the command creates then moves the twin; options come from catalogue seats', () => {
  const rule = { rule: 'mirror-pair', position: [0.5, 0, 0], axis: [1, 0, 0], params: { distances: [0.8] } }
  const store = setup([part('a')])
  store.getState().setItemRules('part', [rule])
  commands.setMirrorPairDistance(store, 'a', 0.8)
  const twin = store.getState().project.items[1]
  assert.equal(twin.mirrored, true)
  assert.deepEqual(twin.position, [1.8, 0, 0])
  commands.setMirrorPairDistance(store, 'a', 1)
  assert.deepEqual(store.getState().project.items[1].position, [2, 0, 0])
  assert.ok(store.getState().project.items.every((it) => it.constraints.find((c) => c.type === 'mirrorPair').distance === 1))
  assert.equal(store.getState().past.length, 2)

  const seat = { id: 'seat', kind: 'laterale', position: [0.5, 0, 0] }
  const shelfPoints = [{ id: 'l', kind: 'laterale', position: [-0.6, 0, 0] }, { id: 'r', kind: 'laterale', position: [0.6, 0, 0] }]
  const options = spacing.pairSpacingOptions('upright', {
    catalog: { upright: { id: 'upright', label: 'U', glbUrl: '/u.glb', snapPoints: [seat] }, shelf: { id: 'shelf', label: 'Shelf', glbUrl: '/s.glb', snapPoints: shelfPoints } },
    itemSnaps: {}, itemRules: { upright: [rule] },
    manifest: { version: 1, products: [
      { catalogId: 'upright', connectors: [{ id: 'seat', snapKind: 'laterale', compatibleWith: ['end'] }] },
      { catalogId: 'shelf', connectors: [{ id: 'end', snapKind: 'laterale' }] },
    ] },
  })
  assert.deepEqual(options, [{ distance: 0.8, fits: [] }, { distance: 1.2, fits: ['Shelf'] }])
})

test('the manifest decides compatibility; the kind table only applies when connectors declare none', () => {
  const hook = { id: 'hook', kind: 'gancio', position: [0, 0, 0] }
  const rail = { id: 'rail', kind: 'binario', position: [0, 0, 0] }
  assert.equal(connectorsCanMate({ id: 'h', snapKind: 'gancio', compatibleWith: ['r'] }, hook, { id: 'r', snapKind: 'binario' }, rail), true)
  assert.equal(connectorsCanMate({ id: 'h', snapKind: 'gancio' }, hook, { id: 'r', snapKind: 'binario' }, rail), false)
  assert.equal(connectorsCanMate({ id: 'a', snapKind: 'laterale' }, { ...hook, kind: 'laterale' }, { id: 'b', snapKind: 'laterale' }, { ...rail, kind: 'laterale' }), true)
  assert.equal(connectorsCanMate({ id: 'h', snapKind: 'gancio', compatibleWith: ['other'] }, hook, { id: 'r', snapKind: 'binario' }, rail), false)
  parseAssemblyManifest({ version: 1, products: [{ catalogId: 'x', connectors: [{ id: 'h', snapKind: 'gancio', compatibleWith: ['r'] }] }] })

  // Without a manifest, only points of a kind that can mate are offered.
  const store = setup([part('a')])
  store.getState().setItemSnaps('part', [{ id: 'origin', kind: 'origine', position: [0, 0, 0] }, { id: 'side', kind: 'laterale', position: [0.5, 0, 0] }])
  assert.deepEqual(attachmentPoints(store.getState(), 'a').map((p) => p.id), ['side'])
})

test('anchoring an assembly keeps its mirror pair and joints, and a frozen assembly stays put', () => {
  const pair = (target) => ({ type: 'mirrorPair', target, distance: 1 })
  const store = setup([part('a', [0, 0, 0], { constraints: [pair('b')] }), part('b', [1, 0, 0], { mirrored: true, constraints: [pair('a')] })], [], [{ id: 'bay', position: [5, 0, 5] }])
  commands.snapAssemblyToAnchor(store, 'a', 'bay')
  const [a, b] = store.getState().project.items
  assert.deepEqual([a.position, b.position], [[5, 0, 5], [6, 0, 5]])
  assert.ok(a.constraints.some((c) => c.type === 'mirrorPair') && b.constraints.some((c) => c.type === 'mirrorPair'))
  const frozen = setup([part('a'), part('b', [1, 0, 0], { locked: true })], [joint('a', 'b')], [{ id: 'bay', position: [5, 0, 5] }])
  commands.snapAssemblyToAnchor(frozen, 'a', 'bay')
  assert.deepEqual(frozen.getState().project.items[0].position, [0, 0, 0])
  assert.equal(frozen.getState().past.length, 0)
})

test('the inspector still turns a part whose model is not mounted', () => {
  const store = setup([part('a')])
  store.getState().itemRegistry.delete('a')
  movement.rotateAssembly(store, 'a', Math.PI / 2)
  assert.deepEqual(store.getState().project.items[0].rotation, [0, Math.PI / 2, 0])
})

test('the vertex magnet ignores the parts travelling with the dragged one', () => {
  const store = setup([part('a'), part('b', [1.01, 0, 0]), part('c', [-1.01, 0, 0])])
  const lock = liveDrag.placeDraggedItem(store.getState(), 'a', 0, 0, null, new Set(['b']))
  assert.equal(lock?.otherId, 'c')
  assert.equal(liveDrag.placeDraggedItem(store.getState(), 'a', 0, 0, null, new Set(['b', 'c'])), null)
})

test('pair spacing follows manifest compatibility for kinds the built-in table does not know', () => {
  const rule = { rule: 'mirror-pair', position: [0.5, 0, 0], axis: [1, 0, 0], params: {} }
  const options = spacing.pairSpacingOptions('upright', {
    catalog: {
      upright: { id: 'upright', label: 'U', glbUrl: '/u.glb', snapPoints: [{ id: 'hook', kind: 'gancio', position: [0.5, 0, 0] }] },
      rail: { id: 'rail', label: 'Rail', glbUrl: '/r.glb', snapPoints: [{ id: 'l', kind: 'binario', position: [-0.6, 0, 0] }, { id: 'r', kind: 'binario', position: [0.6, 0, 0] }] },
    },
    itemSnaps: {}, itemRules: { upright: [rule] },
    manifest: { version: 1, products: [
      { catalogId: 'upright', connectors: [{ id: 'hook', snapKind: 'gancio', compatibleWith: ['rail-end'] }] },
      { catalogId: 'rail', connectors: [{ id: 'rail-end', snapKind: 'binario' }] },
    ] },
  })
  assert.deepEqual(options, [{ distance: 1.2, fits: ['Rail'] }])
})
