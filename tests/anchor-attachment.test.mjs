import { test } from 'vitest'
import assert from 'node:assert/strict'
import { Group } from 'three'
import {
  attachToItemsInstead,
  attachmentPoints,
  backAttachment,
  beginAttachment,
  chooseAttachmentAnchor,
  chooseAttachmentPoint,
  computeAnchorPlacement,
  confirmAttachment,
  createConfiguratorStore,
  setAttachmentAnchorDistance,
} from '../src/lib/index.ts'
import { attachmentTargetIds } from '../src/lib/scene/attachment.ts'
import * as movement from '../src/lib/scene/itemMovement.ts'
import * as registry from '../src/lib/scene/itemRegistry.ts'

// A base point goes on the vehicle: the guided attachment offers it the
// enclosure's anchors, then asks the distance from the one chosen. Plain
// store, no React, no WebGL.
const part = (id, position = [0, 0, 0], extra = {}) => ({ id, catalogId: 'side', position, rotation: [0, 0, 0], ...extra })
const points = [
  { id: 'base-front', kind: 'sovrapposizione', position: [0.5, -0.5, 0], normal: [0, -1, 0] },
  { id: 'base-back', kind: 'terra', position: [-0.5, -0.5, 0], normal: [0, -1, 0] },
  { id: 'head', kind: 'sovrapposizione', position: [0.5, 0.5, 0], normal: [0, 1, 0] },
  { id: 'left', kind: 'laterale', position: [0, 0, -0.5], normal: [0, 0, -1] },
  { id: 'right', kind: 'laterale', position: [0, 0, 0.5], normal: [0, 0, 1] },
]
const manifest = { version: 2, products: [{
  catalogId: 'side',
  connectors: [
    { id: 'stack-bottom', snapId: 'base-front', compatibleWith: ['stack-top'] },
    { id: 'stack-top', snapId: 'head', compatibleWith: ['stack-bottom'] },
    { id: 'left', snapId: 'left', compatibleWith: ['right'] },
    { id: 'right', snapId: 'right', compatibleWith: ['left'] },
  ],
  anchorPoints: ['base-front', 'base-back'],
  anchorOffset: { x: 0, z: 0 },
}] }
const anchors = [{ id: 'dx', position: [2, 0, 1] }, { id: 'sx', position: [-2, 0, 1] }]
function setup(items, connections = []) {
  const store = createConfiguratorStore()
  const state = store.getState()
  state.setProject({ id: 'anchor', version: 1, enclosure: { glbUrl: '/van.glb', anchors }, items, connections })
  state.setCatalog([{ id: 'side', label: 'Side', glbUrl: '/side.glb', size: [1, 1, 1], snapPoints: points }])
  state.setItemSize('side', [1, 1, 1])
  state.setItemSnaps('side', points)
  state.setAssemblyManifest(manifest)
  state.setInteriorBBox({ min: [-3, 0, -3], max: [3, 3, 3] })
  for (const item of items) state.itemRegistry.set(item.id, { id: item.id, group: new Group(), localCorners: registry.buildLocalCorners([1, 1, 1]) })
  movement.restoreLiveItems(store.getState())
  return store
}
const placed = (store, id) => store.getState().project.items.find((item) => item.id === id)
const rounded = (vector) => vector.map((value) => Math.round(value * 1e9) / 1e9 + 0)

test('a base point is offered the anchors of the vehicle, then the distance in depth and width', () => {
  const joint = { sourceItemId: 'b', targetItemId: 'a', sourcePointId: 'left', targetPointId: 'right', sourceConnectorId: 'left', targetConnectorId: 'right' }
  const store = setup([part('a'), part('b', [0, 0, 1])], [joint])
  assert.ok(beginAttachment(store, 'a'))
  // Both base points are interfaces, the one no connector owns included.
  const offered = attachmentPoints(store.getState(), 'a').map((point) => point.id)
  assert.ok(offered.includes('base-front') && offered.includes('base-back'))
  assert.ok(chooseAttachmentPoint(store, 'base-back'))
  assert.equal(store.getState().attachment.stage, 'anchor')
  assert.equal(attachmentTargetIds(store.getState()).size, 0)
  assert.equal(chooseAttachmentAnchor(store, 'missing'), false)
  assert.equal(confirmAttachment(store), false)
  assert.ok(chooseAttachmentAnchor(store, 'dx'))
  assert.deepEqual(store.getState().attachment.anchorDistance, [0, 0, 0])
  // Depth and width only: the rule lists no height.
  setAttachmentAnchorDistance(store, { x: -0.3, y: 0.5, z: -0.4 })
  assert.deepEqual(store.getState().attachment.anchorDistance, [-0.3, 0, -0.4])
  const preview = computeAnchorPlacement(store.getState(), 'a', 'base-back', anchors[0], store.getState().attachment.anchorDistance)
  assert.ok(preview.valid && !preview.limited)
  assert.deepEqual(store.getState().project.items[0].position, [0, 0, 0], 'a preview moves nothing')
  assert.ok(confirmAttachment(store))
  // The base point sits 30 cm and 40 cm from the anchor, on the floor; the joined part came along.
  assert.deepEqual(rounded(placed(store, 'a').position), [2.2, 0, 0.6])
  assert.deepEqual(rounded(placed(store, 'b').position), [2.2, 0, 1.6])
  assert.deepEqual(placed(store, 'a').constraints, [{ type: 'snapToAnchor', target: 'dx', point: 'base-back', offset: [-0.3, 0, -0.4] }])
  assert.equal(store.getState().project.connections.length, 1)
  assert.equal(store.getState().attachment, null)
  assert.equal(store.getState().past.length, 1)
  store.getState().undo()
  assert.deepEqual(placed(store, 'a').position, [0, 0, 0])
})

test('an anchoring that would leave the van is seated at the distance that fits, and a collision is refused', () => {
  const store = setup([part('a'), part('wall', [2.5, 0, -2.5])])
  beginAttachment(store, 'a')
  chooseAttachmentPoint(store, 'base-back')
  chooseAttachmentAnchor(store, 'dx')
  // On the anchor the body spans x 2 … 3; 20 cm further out it would cross the side.
  setAttachmentAnchorDistance(store, { x: 0.2 })
  const preview = computeAnchorPlacement(store.getState(), 'a', 'base-back', anchors[0], store.getState().attachment.anchorDistance)
  assert.ok(preview.valid && preview.limited)
  assert.equal(preview.offset, undefined)
  // Onto another product: refused, with the reason, and nothing is committed.
  setAttachmentAnchorDistance(store, { x: 0, z: -3.2 })
  assert.equal(confirmAttachment(store), false)
  assert.match(store.getState().attachment.error, /./)
  assert.equal(store.getState().past.length, 0)
  setAttachmentAnchorDistance(store, { x: 0.2, z: 0 })
  assert.ok(confirmAttachment(store))
  assert.deepEqual(rounded(placed(store, 'a').position), [2.5, 0, 1])
  assert.deepEqual(placed(store, 'a').constraints, [{ type: 'snapToAnchor', target: 'dx', point: 'base-back' }])
  assert.match(store.getState().interactionNotice, /ridotta/)
})

test('the anchor stage steps back to the anchor, then to the point; other points still go to components', () => {
  const store = setup([part('a'), part('low', [0, 0, -2])])
  beginAttachment(store, 'a')
  chooseAttachmentPoint(store, 'base-front')
  chooseAttachmentAnchor(store, 'sx')
  backAttachment(store)
  assert.equal(store.getState().attachment.stage, 'anchor')
  assert.equal(store.getState().attachment.anchorId, undefined)
  // This base point also stacks on another part: that way stays open, on request.
  assert.deepEqual([...attachmentTargetIds(store.getState())], ['low'])
  attachToItemsInstead(store)
  assert.equal(store.getState().attachment.stage, 'target')
  backAttachment(store)
  assert.equal(store.getState().attachment.stage, 'source')
  chooseAttachmentPoint(store, 'left')
  assert.equal(store.getState().attachment.stage, 'target')
  // Choosing the same anchor again resumes from the distance the hold has.
  store.getState().setAttachment(null)
  store.getState().updateItem('a', { position: [-2.5, 0, 1.3], constraints: [{ type: 'snapToAnchor', target: 'sx', point: 'base-front', offset: [0, 0, 0.3] }] })
  beginAttachment(store, 'a')
  chooseAttachmentPoint(store, 'base-front')
  chooseAttachmentAnchor(store, 'sx')
  assert.deepEqual(store.getState().attachment.anchorDistance, [0, 0, 0.3])
  chooseAttachmentAnchor(store, 'dx')
  assert.deepEqual(store.getState().attachment.anchorDistance, [0, 0, 0])
})

test('a drag released near an anchor seats a product by its base points only', () => {
  const store = setup([part('a')])
  const live = store.getState().itemRegistry.get('a').group
  // Centre on the anchor: neither base point is within reach, so nothing snaps.
  live.position.set(2, 0.5, 1)
  movement.finishItemMovement(store, 'a', 'translate', [0, 0, 0], anchors, points)
  assert.deepEqual(placed(store, 'a').constraints ?? [], [])
  // The back base point 3 cm from the anchor: seated by it.
  live.position.set(2.53, 0.5, 1)
  movement.finishItemMovement(store, 'a', 'translate', [0, 0, 0], anchors, points)
  assert.deepEqual(rounded(placed(store, 'a').position), [2.5, 0, 1])
  assert.deepEqual(placed(store, 'a').constraints, [{ type: 'snapToAnchor', target: 'dx', point: 'base-back' }])
})
