import { beforeAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import {
  attachmentPointStates, computeAttachmentPreview, connectionsAtPose,
  connectorForSnap, connectorsCanMate, extractItemSnapsFromObject,
  parseAssemblyManifest, parseCatalog, prepareProductAsset, serializeProject, parseProject,
  validateConfiguration, visibleBodyBounds, setMirrorPairDistance, snapsForItem,
} from '../src/lib/index.ts'
import { addItemToScene } from '../src/lib/scene/commands.ts'
import { worldPoint } from '../src/lib/scene/geometry.ts'
import { makeGlb, marker, parseGlb } from './helpers/glb.mjs'
import { createEditor, loadProductionCatalog } from './helpers/production.mjs'

let production
beforeAll(async () => { production = await loadProductionCatalog() })
const sides = ['ysi03036', 'ysi02436', 'ysi01131']
const rows = [['front', 'frontale_int', [-1, 0, 0]], ['front-ext', 'frontale_est', [1, 0, 0]], ['lateral-int', 'laterale_int', [0, 0, -1]], ['lateral-ext', 'laterale_est', [0, 0, 1]]]
const near = (a, b, tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

// Fixed file expectations, not values taken from the repetition implementation.
const expected = { ysi03036: [30, 0.3594, 0.3635], ysi02436: [24, 0.358, 0.3605], ysi01131: [11, 0.3094, 0.3135] }
test('real side panels duplicate the four CAD interfaces at every 36 mm hole without stale grids or duplicate seeds', () => {
  for (const id of sides) {
    const item = production.built.items.find((p) => p.id === id)
    const source = production.scenes[production.fileOf[id]]
    const center = visibleBodyBounds(source).getCenter(new Vector3()).toArray()
    const markers = extractItemSnapsFromObject(source).map((p) => p.extracted)
    const { metadata } = production.prepare(id)
    const [count, innerX, outerX] = expected[id]
    assert.equal(item.autoSnapGrid, false)
    assert.ok(!metadata.rules.some((r) => r.rule === 'auto-snap-grid'))
    assert.ok(!metadata.snaps.some((p) => p.id.startsWith('auto-grid-')))
    assert.equal(new Set(metadata.snaps.map((p) => p.id)).size, metadata.snaps.length)
    for (const [prefix, kind, normal] of rows) {
      const points = metadata.snaps.filter((p) => p.kind === kind)
      assert.equal(points.length, count, `${id}:${kind}`)
      const seed = markers.find((p) => p.id === kind)
      assert.ok(!metadata.snaps.some((p) => p.id === seed.id), 'row 1 replaces its seed')
      for (let i = 0; i < points.length; i++) {
        assert.equal(points[i].id, `${prefix}-${i + 1}`)
        assert.deepEqual(points[i].normal, normal)
        const glb = points[i].position.map((v, a) => v + center[a])
        assert.ok(near(glb, [seed.position[0], 0.018 + 0.036 * i, seed.position[2]]))
        if (kind === 'frontale_int') assert.ok(Math.abs(glb[0] - innerX) < 1e-6)
        if (kind === 'frontale_est') assert.ok(Math.abs(glb[0] - outerX) < 1e-6)
      }
    }
  }
})

test('repetition follows scale, updates the asset cache, and rejects missing seeds and clashing IDs', async () => {
  const source = await parseGlb(makeGlb([
    { name: 'Body', min: [0, 0, -0.03], max: [0.36, 0.108, 0] },
    marker('SNAP_FRONTALE__CONTACT', [0.358, 0.018, -0.017]),
    { name: 'RULE_AUTOSNAPGRID' },
  ]))
  const input = { id: 'test', label: 'Test', glbUrl: '/test.glb', snapDirections: { contact: [-1, 0, 0] }, snapRepeats: [{ id: 'row', snapId: 'contact', pitch: [0, 0.036, 0] }] }
  const catalog = parseCatalog([input])[0]
  assert.deepEqual(catalog.snapRepeats, input.snapRepeats)
  assert.deepEqual(parseAssemblyManifest({ version: 2, products: [{ catalogId: 'test', connectors: [], snapRepeats: input.snapRepeats }] }).products[0].snapRepeats, input.snapRepeats)
  const base = prepareProductAsset(source, catalog)
  const scaled = prepareProductAsset(source, { ...catalog, scale: 2 })
  assert.equal(base.metadata.snaps.length, 3)
  assert.ok(!base.metadata.rules.some((r) => r.rule === 'auto-snap-grid'))
  scaled.metadata.snaps.forEach((p, i) => assert.ok(near(p.position, base.metadata.snaps[i].position.map((v) => v * 2))))
  const changed = prepareProductAsset(source, { ...catalog, snapRepeats: [{ ...input.snapRepeats[0], pitch: [0, 0.072, 0] }] })
  assert.equal(changed.metadata.snaps.length, 2)
  assert.equal(prepareProductAsset(source, catalog), base)
  assert.throws(() => prepareProductAsset(source, { ...catalog, snapRepeats: [{ ...input.snapRepeats[0], snapId: 'missing' }] }), /assente/)
  assert.throws(() => prepareProductAsset(source, { ...catalog, snapPoints: [{ id: 'row-1', kind: 'other', position: [0, 0, 0] }], replaceSnapKinds: [] }), /duplicato/)
  for (const pitch of [[0, 0, 0], [0, Infinity, 0], [0, 1e-10, 0]]) assert.throws(() => parseCatalog([{ ...input, snapRepeats: [{ ...input.snapRepeats[0], pitch }] }]))
  assert.throws(() => parseCatalog([{ ...input, snapRepeats: [input.snapRepeats[0], input.snapRepeats[0]] }]), (error) => error.issues.some((issue) => issue.message === 'Duplicate snapId'))
})

const add = (editor, catalogId) => {
  const id = addItemToScene(editor.store, editor.store.getState().catalog[catalogId])
  editor.hydrate()
  return id
}
const cases = [
  ['kdw40236', 'end-a', 'frontale_int'], ['kdw40336', 'end-a', 'frontale_int'],
  ['kdw40436', 'end-a', 'frontale_int'], ['kdw40636', 'end-a', 'frontale_int'],
  ['kcp40531kmd02', 'end-a', 'frontale_int'], ['kld41000', 'end-a', 'frontale_int'],
  ['kud40900', 'end-a', 'frontale_int'], ['xds40231km02', 'frontale', 'frontale_int'],
  ['xds40236km02', 'laterale-1', 'laterale_int'], ['xha40100', 'frontale', 'frontale_int'],
  ['ptbm31', 'frontale', 'frontale_est'], ['ptbm26', 'laterale', 'laterale_est'],
]
test('attachment filtering and joint validation respect INT/EST for every product family, on each side panel', () => {
  for (const sideId of sides) for (const [productId, sourcePointId, allowedKind] of cases) {
    const editor = createEditor(production)
    const targetId = add(editor, sideId)
    const sourceId = add(editor, productId)
    const state = editor.store.getState()
    const states = attachmentPointStates(state, targetId, { itemId: sourceId, pointId: sourcePointId })
    const contactStates = states.filter((entry) => rows.some(([, kind]) => entry.point.kind === kind))
    assert.ok(contactStates.some((entry) => entry.point.kind === allowedKind && entry.status === 'free'), `${sideId}:${productId}:${sourcePointId}`)
    for (const entry of contactStates) assert.equal(entry.status, entry.point.kind === allowedKind ? 'free' : 'incompatible', `${sideId}:${productId}:${entry.point.id}`)
    const sourcePoint = state.itemSnaps[productId].find((p) => p.id === sourcePointId)
    const sourceConnector = connectorForSnap(production.manifest.products.find((p) => p.catalogId === productId), sourcePoint)
    const opposite = contactStates.find((entry) => entry.point.kind === allowedKind.replace(/_(int|est)$/, allowedKind.endsWith('_int') ? '_est' : '_int')).point
    const targetConnector = connectorForSnap(production.manifest.products.find((p) => p.catalogId === sideId), opposite)
    assert.equal(connectorsCanMate(sourceConnector, sourcePoint, targetConnector, opposite), false)
    assert.equal(connectorsCanMate(targetConnector, opposite, sourceConnector, sourcePoint), false)
    assert.equal(computeAttachmentPreview(state, sourceId, sourcePointId, targetId, opposite.id).reason, 'incompatible')
    const invalid = { ...state.project, connections: [{ sourceItemId: sourceId, sourcePointId, sourceConnectorId: sourceConnector.id, targetItemId: targetId, targetPointId: opposite.id, targetConnectorId: targetConnector.id }] }
    assert.ok(validateConfiguration(invalid, state.catalog, production.manifest, state).some((issue) => issue.level === 'error' && issue.reason === 'connectors-incompatible'))
  }
})

test('drawer INT and accessory EST contacts align with the generated markers and survive project round trips', () => {
  for (const [productId, sourcePointId, targetPointId] of [['kdw40236', 'end-a', 'front-14'], ['ptbm31', 'frontale', 'front-ext-14'], ['ptbm26', 'laterale', 'lateral-ext-14']]) {
    const editor = createEditor(production)
    const targetId = add(editor, 'ysi03036')
    setMirrorPairDistance(editor.store, targetId, 1.014)
    editor.hydrate()
    const twinId = editor.store.getState().project.items.find((p) => p.mirrored).id
    const sourceId = add(editor, productId)
    const state = editor.store.getState()
    const mirrored = computeAttachmentPreview(state, sourceId, productId === 'kdw40236' ? 'end-b' : sourcePointId, twinId, targetPointId)
    assert.equal(mirrored.valid, true, `${productId} mirrored: ${mirrored.error}`)
    const twin = state.project.items.find((p) => p.id === twinId)
    const twinPoint = snapsForItem(twin, state.itemSnaps, state.itemRules).find((p) => p.id === targetPointId)
    const originalPoint = state.itemSnaps.ysi03036.find((p) => p.id === targetPointId)
    assert.equal(twinPoint.position[2], -originalPoint.position[2])
    const preview = computeAttachmentPreview(state, sourceId, sourcePointId, targetId, targetPointId)
    assert.equal(preview.valid, true, `${productId}: ${preview.error}`)
    state.commitJoints(preview.patches, preview.joints)
    editor.hydrate()
    const next = editor.store.getState()
    const source = next.project.items.find((p) => p.id === sourceId)
    const target = next.project.items.find((p) => p.id === targetId)
    const sourcePoint = next.itemSnaps[productId].find((p) => p.id === sourcePointId)
    const targetPoint = next.itemSnaps.ysi03036.find((p) => p.id === targetPointId)
    assert.ok(near(worldPoint(source, sourcePoint.position, next.itemSizes[productId][1]), worldPoint(target, targetPoint.position, next.itemSizes.ysi03036[1])))
    assert.ok(connectionsAtPose(source, source, { items: next.project.items, itemSnaps: next.itemSnaps, manifest: production.manifest, heightOf: (p) => next.itemSizes[p.catalogId][1] }).some((joint) => joint.targetPointId === targetPointId))
    const saved = serializeProject(next.exportProject())
    assert.equal(serializeProject(parseProject(saved, { catalog: production.built.items }).project), saved)
  }
})
