import { test } from 'vitest'
import assert from 'node:assert/strict'
import { Group } from 'three'
import { createConfiguratorStore, computeAttachmentPreview, serializeProject } from '../src/lib/index.ts'
import * as movement from '../src/lib/scene/itemMovement.ts'
import * as registry from '../src/lib/scene/itemRegistry.ts'
import * as previews from '../src/lib/scene/connectionPreview.ts'

// The common release operations called by both pointer and gizmo handlers, on a plain store.
const { finishItemMovement, rotateAssembly, restoreLiveItems, applyLiveItemPatches, commitLiveItemPatches } = movement
const part = (id, position = [0, 0, 0], extra = {}) => ({ id, catalogId: 'part', position, rotation: [0, 0, 0], ...extra })
const joint = (a, b) => ({ sourceItemId: a, targetItemId: b, sourcePointId: 'left', targetPointId: 'right', sourceConnectorId: 'left', targetConnectorId: 'right' })
const points = [
  { id: 'left', kind: 'laterale', position: [-0.5, 0, 0], normal: [-1, 0, 0] },
  { id: 'right', kind: 'laterale', position: [0.5, 0, 0], normal: [1, 0, 0] },
]
function setup(items, connections = []) {
  const store = createConfiguratorStore()
  const state = store.getState()
  state.setProject({ id: 'movement', version: 1, enclosure: { glbUrl: '/van.glb' }, items, connections })
  state.setCatalog([{ id: 'part', label: 'Part', glbUrl: '/part.glb', size: [1, 1, 1], snapPoints: points }])
  state.setItemSize('part', [1, 1, 1])
  state.setItemSnaps('part', points)
  state.setAssemblyManifest({ version: 1, products: [{ catalogId: 'part', connectors: [
    { id: 'left', snapId: 'left', compatibleWith: ['right'] },
    { id: 'right', snapId: 'right', compatibleWith: ['left'] },
  ] }] })
  for (const item of items) state.itemRegistry.set(item.id, { id: item.id, group: new Group(), localCorners: registry.buildLocalCorners([1, 1, 1]) })
  restoreLiveItems(store.getState())
  return store
}
const live = (store, id) => store.getState().itemRegistry.get(id).group
const snapshot = (store) => serializeProject(store.getState().exportProject())

// These are the common release operations called by both pointer and gizmo handlers.
test('translation carries every assembly member, preserves joints and is one undo step', () => {
  const store = setup([part('a'), part('b', [1, 0, 0]), part('c', [2, 0, 0]), part('outside', [20, 0, 0])], [joint('b', 'a'), joint('c', 'b')])
  const before = snapshot(store)
  live(store, 'b').position.set(5, 2.5, 4)
  finishItemMovement(store, 'b', 'translate', [0, 0, 0], [], points)
  assert.deepEqual(store.getState().project.items.map((item) => item.position), [[4, 2, 4], [5, 2, 4], [6, 2, 4], [20, 0, 0]])
  assert.deepEqual(live(store, 'c').position.toArray(), [6, 2.5, 4])
  assert.equal(store.getState().project.connections.length, 2)
  assert.equal(store.getState().past.length, 1)
  const after = snapshot(store)
  store.getState().undo()
  assert.equal(snapshot(store), before)
  store.getState().redo()
  assert.equal(snapshot(store), after)
})

test('gesture and inspector rotation produce identical rigid assembly poses', () => {
  const items = [part('a'), part('b', [2, 0, 0])]
  const gesture = setup(items, [joint('b', 'a')]), inspector = setup(items, [joint('b', 'a')])
  live(gesture, 'a').rotation.y = Math.PI / 2
  finishItemMovement(gesture, 'a', 'rotate', [0, Math.PI / 2, 0], [], points)
  rotateAssembly(inspector, 'a', Math.PI / 2)
  assert.equal(snapshot(gesture), snapshot(inspector))
  assert.ok(Math.abs(live(gesture, 'b').position.x) < 1e-10)
  assert.equal(live(gesture, 'b').position.z, -2)
  assert.deepEqual(live(gesture, 'a').position.toArray(), [0, 0.5, 0])
  assert.equal(gesture.getState().past.length, 1)
})

test('cancelling a live assembly preview restores all poses without editing project or history', () => {
  const store = setup([part('a'), part('b', [1, 0, 0])], [joint('b', 'a')])
  const before = snapshot(store)
  applyLiveItemPatches(store.getState().itemRegistry, [
    { id: 'a', patch: { position: [5, 3, 2], rotation: [0, Math.PI / 2, 0] } },
    { id: 'b', patch: { position: [5, 3, 1], rotation: [0, Math.PI / 2, 0] } },
  ])
  restoreLiveItems(store.getState())
  assert.deepEqual(live(store, 'a').position.toArray(), [0, 0.5, 0])
  assert.deepEqual(live(store, 'b').position.toArray(), [1, 0.5, 0])
  assert.equal(live(store, 'b').rotation.y, 0)
  assert.equal(snapshot(store), before)
  assert.equal(store.getState().past.length, 0)
})

test('translation attaches to an anchor and undo restores the previous free pose', () => {
  const store = setup([part('a', [3, 0, 0])])
  live(store, 'a').position.set(0.02, 0.5, 0)
  finishItemMovement(store, 'a', 'translate', [0, 0, 0], [{ id: 'floor', position: [0, 0, 0] }], [])
  assert.deepEqual(store.getState().project.items[0].position, [0, 0, 0])
  assert.deepEqual(store.getState().project.items[0].constraints, [{ type: 'snapToAnchor', target: 'floor' }])
  store.getState().undo()
  assert.deepEqual(store.getState().project.items[0].position, [3, 0, 0])
})

test('in-place rotation keeps a centre anchor but releases a corner anchor', () => {
  for (const [extra, retained] of [[{}, true], [{ corner: 0 }, false]]) {
    const anchor = { type: 'snapToAnchor', target: 'floor', ...extra }
    const store = setup([part('a', [0, 0, 0], { constraints: [anchor] })])
    finishItemMovement(store, 'a', 'rotate', [0, Math.PI / 2, 0], [], [])
    assert.deepEqual(store.getState().project.items[0].constraints, retained ? [anchor] : [])
    assert.deepEqual(store.getState().project.items[0].position, [0, 0, 0])
  }
})

test('collision corrections invalidate an anchor that would put the body outside the enclosure', () => {
  const store = setup([part('a')])
  store.getState().setInteriorBBox({ min: [-1, 0, -1], max: [1, 2, 1] })
  live(store, 'a').position.set(0.5, 0.5, 0)
  finishItemMovement(store, 'a', 'translate', [0, 0, 0], [{ id: 'bad-floor', position: [0.54, 0, 0] }], [])
  assert.equal(store.getState().project.items[0].position[0], 0.5)
  assert.ok(!store.getState().project.items[0].constraints?.some((constraint) => constraint.type === 'snapToAnchor'))
})

test('an assembly is kept inside the van as one body, not just the part that was grabbed', () => {
  const store = setup([part('a'), part('b', [1, 0, 0]), part('c', [2, 0, 0])], [joint('b', 'a'), joint('c', 'b')])
  store.getState().setInteriorBBox({ min: [-3, 0, -2], max: [3, 2, 2] })
  // Grab the end part and pull: alone it fits at x = 1.5, but the far end would sit at 3.5.
  live(store, 'a').position.set(1.5, 0.5, 0)
  finishItemMovement(store, 'a', 'translate', [0, 0, 0], [], points)
  assert.deepEqual(store.getState().project.items.map((item) => item.position), [[0.5, 0, 0], [1.5, 0, 0], [2.5, 0, 0]])
  assert.equal(store.getState().project.connections.length, 2)
  // A turn about the far end swings the others past the side; the whole wall steps back in.
  rotateAssembly(store, 'c', Math.PI / 2)
  const positions = store.getState().project.items.map((item) => item.position.map((value) => Math.round(value * 1e9) / 1e9 + 0))
  assert.deepEqual(positions, [[2.5, 0, 1.5], [2.5, 0, 0.5], [2.5, 0, -0.5]])
})

test('switching to readonly or locking a follower during a gesture rejects it and restores live poses', () => {
  for (const block of [
    (store) => store.getState().setReadOnly(true),
    (store) => store.getState().updateItem('b', { locked: true }),
  ]) {
    const store = setup([part('a'), part('b', [1, 0, 0])], [joint('b', 'a')])
    live(store, 'a').position.set(7, 0.5, 3)
    block(store)
    const before = snapshot(store), history = store.getState().past.length
    finishItemMovement(store, 'a', 'translate', [0, 0, 0], [], [])
    assert.equal(snapshot(store), before)
    assert.equal(store.getState().past.length, history)
    assert.deepEqual(live(store, 'a').position.toArray(), [0, 0.5, 0])
  }
})

test('invalid scene edits restore live poses without creating undo entries', () => {
  const store = setup([part('a')]), before = snapshot(store)
  live(store, 'a').position.x = 5
  assert.throws(() => commitLiveItemPatches(store, [{ id: 'a', patch: { position: [NaN, 0, 0] } }]))
  assert.equal(snapshot(store), before)
  assert.equal(store.getState().past.length, 0)
  assert.equal(live(store, 'a').position.x, 0)
})

test('magnetic and guided attachment resolve the same pose and joints without mutating the project', () => {
  const store = setup([part('source', [3, 0, 0]), part('target')]), before = snapshot(store)
  live(store, 'source').position.set(1.03, 0.5, 0)
  const magnetic = previews.resolveConnectionPreview(store.getState(), 'source')
  const guided = computeAttachmentPreview(store.getState(), 'source', 'left', 'target', 'right')
  assert.equal(magnetic.valid, true)
  assert.equal(guided.valid, true)
  assert.deepEqual(magnetic.position, guided.patches.find((patch) => patch.id === 'source').patch.position)
  assert.deepEqual(magnetic.joints, guided.joints)
  assert.equal(snapshot(store), before)
  assert.equal(live(store, 'source').position.x, 1.03)
  assert.equal(store.getState().past.length, 0)
})

test('guided attachment allows temporary out-of-bounds placement while magnetic attachment rejects it', () => {
  const store = setup([part('source', [3, 0, 0]), part('target')])
  store.getState().setInteriorBBox({ min: [-0.5, 0, -1], max: [0.6, 2, 1] })
  live(store, 'source').position.set(1.03, 0.5, 0)
  const magnetic = previews.resolveConnectionPreview(store.getState(), 'source')
  const guided = computeAttachmentPreview(store.getState(), 'source', 'left', 'target', 'right')
  assert.equal(magnetic.valid, false)
  assert.match(magnetic.reason, /fuori dal vano/)
  assert.equal(guided.valid, true)
  assert.match(guided.warning, /fuori dal vano/)
})

test('committing a magnetic seat matches the guided project and creates exactly one undo entry', () => {
  const magneticStore = setup([part('source', [3, 0, 0]), part('target')])
  const guidedStore = setup([part('source', [3, 0, 0]), part('target')])
  const before = snapshot(magneticStore)
  live(magneticStore, 'source').position.set(1.03, 0.5, 0)
  const preview = previews.resolveConnectionPreview(magneticStore.getState(), 'source')
  assert.equal(previews.commitConnectionPreview(magneticStore, preview), true)
  const guided = computeAttachmentPreview(guidedStore.getState(), 'source', 'left', 'target', 'right')
  guidedStore.getState().commitJoints(guided.patches, guided.joints)
  assert.equal(snapshot(magneticStore), snapshot(guidedStore))
  assert.deepEqual(live(magneticStore, 'source').position.toArray(), [1, 0.5, 0])
  assert.equal(magneticStore.getState().past.length, 1)
  magneticStore.getState().undo()
  assert.equal(snapshot(magneticStore), before)
})

test('a magnetic preview cannot commit after readonly is enabled', () => {
  const store = setup([part('source', [3, 0, 0]), part('target')])
  live(store, 'source').position.set(1.03, 0.5, 0)
  const preview = previews.resolveConnectionPreview(store.getState(), 'source')
  store.getState().setReadOnly(true)
  const before = snapshot(store)
  previews.commitConnectionPreview(store, preview)
  assert.equal(snapshot(store), before)
  assert.equal(store.getState().past.length, 0)
  assert.deepEqual(live(store, 'source').position.toArray(), [3, 0.5, 0])
})
