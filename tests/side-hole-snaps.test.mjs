import { beforeAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { Group, Mesh, ExtrudeGeometry, Shape, Path, ShapeGeometry } from 'three'
import { prepareProductAsset, parseCatalog, parseAssemblyManifest, computeAttachmentPreview, stepItemSnap, setMirrorPairDistance } from '../src/lib/index.ts'
import { addItemToScene } from '../src/lib/scene/commands.ts'
import { createEditor, loadProductionCatalog } from './helpers/production.mjs'

let production
beforeAll(async () => { production = await loadProductionCatalog() })
const families = new Set(['frontale_int', 'frontale_est', 'laterale_int', 'laterale_est', 'posteriore_int', 'posteriore_est'])
const near = (a, b, tolerance = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < tolerance)

function plate({ horizontal = false, open = false } = {}) {
  const shape = new Shape()
  shape.moveTo(0, 0); shape.lineTo(0.1, 0); shape.lineTo(0.1, 0.1); shape.lineTo(0, 0.1); shape.closePath()
  for (const [x, y] of [[0.03, 0.03], [0.07, 0.07]]) { const hole = new Path(); hole.absarc(x, y, 0.004, 0, Math.PI * 2, true); shape.holes.push(hole) }
  const root = new Group(), mesh = new Mesh(open ? new ShapeGeometry(shape) : new ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false, curveSegments: 12 }))
  if (horizontal) mesh.rotation.x = Math.PI / 2
  root.add(mesh)
  return root
}
const item = { id: 'plate', label: 'Plate', glbUrl: '/plate.glb', sideHoleSnaps: true }

test('paired generation finds irregular actual holes, rejects open faces and excludes upper and lower faces', () => {
  const generated = prepareProductAsset(plate(), item).metadata.snaps
  assert.equal(generated.length, 4)
  assert.equal(generated.filter((p) => p.kind.endsWith('_int')).length, 2)
  assert.equal(generated.filter((p) => p.kind.endsWith('_est')).length, 2)
  assert.equal(new Set(generated.map((p) => p.id)).size, 4)
  assert.ok(generated.every((p) => p.series && p.normal[1] === 0))
  assert.equal(prepareProductAsset(plate({ horizontal: true }), item).metadata.snaps.length, 0)
  assert.equal(prepareProductAsset(plate({ open: true }), item).metadata.snaps.length, 0)
  assert.equal(prepareProductAsset(plate(), { ...item, snapRepeats: [{ id: 'legacy', snapId: 'missing', pitch: [0, 0.036, 0] }] }).metadata.snaps.length, 4, 'geometry detection does not require legacy seed markers')
  // This is geometry detection, not a 36 mm repetition: exactly the two authored heights.
  assert.deepEqual([...new Set(generated.map((p) => Math.round(p.position[1] * 1000)))].sort(), [-20, 20])
})

test('flag, series metadata and scaled hole positions survive JSON parsing and cache changes', () => {
  assert.equal(parseCatalog([item])[0].sideHoleSnaps, true)
  assert.equal(parseAssemblyManifest({ version: 2, products: [{ catalogId: 'plate', connectors: [], sideHoleSnaps: true }] }).products[0].sideHoleSnaps, true)
  const root = plate(), base = prepareProductAsset(root, item), twice = prepareProductAsset(root, { ...item, scale: 2 })
  assert.equal(twice.metadata.snaps.length, base.metadata.snaps.length)
  twice.metadata.snaps.forEach((point, index) => {
    assert.equal(point.id, base.metadata.snaps[index].id)
    assert.ok(near(point.position, base.metadata.snaps[index].position.map((v) => v * 2)))
    assert.deepEqual(point.normal, base.metadata.snaps[index].normal)
  })
  const parsed = parseCatalog([{ ...item, snapPoints: base.metadata.snaps }])[0]
  assert.deepEqual(parsed.snapPoints, base.metadata.snaps)
  assert.equal(prepareProductAsset(root, { ...item, sideHoleSnaps: false }).metadata.snaps.length, 0)
  assert.equal(prepareProductAsset(root, item), base)
})

test('all real side panel holes receive unique internal/external counterparts, including unmarked rear and lateral columns', () => {
  for (const [id, front, lateral, rear] of [['ysi03036', 30, 180, 30], ['ysi02436', 24, 144, 24], ['ysi01131', 11, 55, 11]]) {
    const metadata = production.prepare(id).metadata
    const points = metadata.snaps.filter((p) => families.has(p.kind))
    for (const [family, count] of [['frontale', front], ['laterale', lateral], ['posteriore', rear]]) {
      for (const side of ['int', 'est']) assert.equal(points.filter((p) => p.kind === `${family}_${side}`).length, count, `${id}:${family}_${side}`)
    }
    assert.equal(new Set(metadata.snaps.map((p) => p.id)).size, metadata.snaps.length)
    for (const point of points) {
      assert.equal(point.normal[1], 0)
      assert.ok(point.series)
      const axis = Math.abs(point.normal[0]) > 0.5 ? 0 : 2
      const counterpartKind = point.kind.replace(/_(int|est)$/, point.kind.endsWith('_int') ? '_est' : '_int')
      assert.ok(points.some((other) => other.kind === counterpartKind &&
        other.normal.every((v, a) => v === -point.normal[a]) &&
        point.position.every((v, a) => a === axis || Math.abs(v - other.position[a]) < 1e-5) &&
        Math.abs(point.position[axis] - other.position[axis]) < 0.014), `${id}:${point.id}`)
    }
    assert.equal(metadata.snaps.filter((p) => /^front-\d+$/.test(p.id)).length, front, 'published front IDs retained')
    assert.equal(metadata.snaps.filter((p) => /^back-\d+$/.test(p.id)).length, rear, 'published rear IDs retained')
  }
})

test('an accessory can mount and step on a newly detected column on both mirrored and ordinary sides', () => {
  for (const mirrored of [false, true]) {
    const editor = createEditor(production)
    const add = (catalogId) => { const id = addItemToScene(editor.store, editor.store.getState().catalog[catalogId]); editor.hydrate(); return id }
    const side = add('ysi03036')
    setMirrorPairDistance(editor.store, side, 1.014); editor.hydrate()
    const target = mirrored ? editor.store.getState().project.items.find((p) => p.mirrored).id : side
    const accessory = add('ptbm26'), state = editor.store.getState()
    const point = state.itemSnaps.ysi03036.find((p) => p.kind === 'laterale_est' && p.normal[2] === 1 && p.id.startsWith('holes-') && p.position[1] > -0.1 && p.position[1] < 0)
    assert.ok(point)
    const row = state.itemSnaps.ysi03036.filter((p) => p.series === point.series).sort((a, b) => a.position[1] - b.position[1])
    const next = row[row.findIndex((p) => p.id === point.id) + 1]
    const preview = computeAttachmentPreview(state, accessory, 'laterale', target, point.id)
    assert.equal(preview.valid, true, preview.error)
    state.commitJoints(preview.patches, preview.joints); editor.hydrate()
    assert.equal(stepItemSnap(editor.store, accessory, 1), true)
    assert.ok(editor.store.getState().project.connections.some((p) => p.targetItemId === target && p.targetPointId === next.id))
  }
})
