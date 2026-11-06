import { test, beforeAll } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Box3, Vector3 } from 'three'
import {
  attachmentPointStates,
  beginAttachment,
  buildProjectBom,
  checkCatalog,
  chooseAttachmentPoint,
  chooseAttachmentTarget,
  computeAttachmentPreview,
  extractItemSnapsFromObject,
  extractRulesFromObject,
  parseProject,
  serializeProject,
  setMirrorPairDistance,
  snapsForItem,
  validateConfiguration,
  visibleBodyBounds,
} from '../src/lib/index.ts'
import { addItemToScene } from '../src/lib/scene/commands.ts'
import { finishItemMovement, rotateAssembly } from '../src/lib/scene/itemMovement.ts'
import { pairSpacingOptions } from '../src/lib/assembly/pairSpacing.ts'
import { worldPoint } from '../src/lib/scene/geometry.ts'
import { createEditor, loadProductionCatalog } from './helpers/production.mjs'
import { TASCA_CATALOG_GROUPS, buildTascaWall, tascaWallContext } from './fixtures/tasca-99003819/legacyDemo.ts'

// The Syncro 1014 wall of quote 99003819 on the production path: catalogue
// built from the customer GLBs and catalog/manifest.json, composed by hand
// with the editor commands, compared with the reference kept in
// tests/fixtures/tasca-99003819 (the former demo generator and its output).

const PITCH = 0.036
const BAY = 1.014
const SHEET = 0.0015
const WALL = ['ysi03036', 'ysi01131', 'kdw40236', 'kdw40336', 'kdw40436', 'kdw40636', 'kcp40531kmd02', 'kma40100', 'xla40400', 'kdu40426kd080', 'kld41000', 'kud40900']
const HUNG = WALL.filter((id) => !id.startsWith('ysi') && id !== 'kdu40426kd080')
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol
const fixture = (name) => readFile(`tests/fixtures/tasca-99003819/${name}`, 'utf8').then(JSON.parse)

let production
let reference
let referenceBom
let ivecoEnclosure
beforeAll(async () => {
  production = await loadProductionCatalog()
  reference = await fixture('reference-project.json')
  referenceBom = await fixture('reference-bom.json')
  ivecoEnclosure = production.built.enclosures.find((vehicle) => vehicle.id === 'iveco-dl14l2sh3').enclosure
})

const item = (id) => production.built.items.find((entry) => entry.id === id)
const definition = (id) => production.manifest.products.find((entry) => entry.catalogId === id)

test('the production catalogue carries the whole wall, built from files and manifest only', () => {
  assert.deepEqual(production.built.issues.filter((issue) => issue.level === 'error'), [])
  for (const id of WALL) {
    const product = item(id)
    assert.ok(product, id)
    assert.ok(product.label && product.description && product.category, id)
    assert.equal(product.code.toLowerCase(), id)
    // The body size is the GLB's own, markers excluded.
    const bounds = visibleBodyBounds(production.scenes[production.fileOf[id]])
    bounds.getSize(new Vector3()).toArray().forEach((side, axis) => assert.ok(near(side, product.size[axis], 1e-6), `${id}[${axis}]`))
    // Every correction belongs to the very file it was written for.
    assert.ok(definition(id).assetCorrections.every((correction) => product.assetHash.startsWith(correction.asset)), id)
  }
  assert.deepEqual(production.built.enclosures.map((vehicle) => vehicle.id).sort(), ['fiat-ndc40h2', 'iveco-dl14l2sh3'])
})

test('side panels: hole columns on the inner face of each flange, numbered from the floor', () => {
  for (const [id, depth, height, holes] of [['ysi03036', 0.363, 1.08, 30], ['ysi01131', 0.313, 0.396, 11]]) {
    const snaps = production.prepare(id).metadata.snaps
    const center = visibleBodyBounds(production.scenes[production.fileOf[id]]).getCenter(new Vector3())
    const glb = (point) => point.position.map((value, i) => value + center.getComponent(i))
    for (const [column, face, inward] of [['front', depth, -SHEET], ['back', 0, SHEET]]) {
      const points = snaps.filter((point) => point.id.startsWith(`${column}-`))
      assert.equal(points.length, holes, `${id} ${column}`)
      points.forEach((point, k) => {
        assert.equal(point.id, `${column}-${k + 1}`)
        const [x, y, z] = glb(point)
        assert.ok(near(x, face + inward, 1e-5) && near(y, PITCH / 2 + k * PITCH, 1e-5) && near(z, -0.017, 1e-5), `${id} ${point.id} ${[x, y, z]}`)
        assert.deepEqual(point.normal, [0, 0, -1])
      })
    }
    // The CAD's own numbered SNAP_FRONTALE marker is replaced by the column, not added to it.
    assert.equal(snaps.filter((point) => point.kind === 'frontale').length, holes)
    assert.ok(near(glb(snaps.find((point) => point.id === 'stack-top'))[1], height, 1e-5))
  }
})

test('every hung part bears on the sheet with its CAD marker corrected once', () => {
  for (const id of HUNG) {
    const scene = production.scenes[production.fileOf[id]]
    const center = visibleBodyBounds(scene).getCenter(new Vector3())
    const snaps = production.prepare(id).metadata.snaps
    const ends = snaps.filter((point) => point.id === 'end-a' || point.id === 'end-b')
    assert.equal(ends.length, 2, id)
    // No raw CAD marker of the corrected kind survives next to the corrected ends.
    assert.equal(snaps.filter((point) => point.kind === 'frontale').length, 2, id)
    const width = ends[0].normal[0] !== 0 ? 0 : 2
    const depth = 2 - width
    for (const marker of extractItemSnapsFromObject(scene).filter((entry) => entry.extracted.kind === 'frontale')) {
      const cad = marker.extracted.position.map((value, i) => value - center.getComponent(i))
      // The legacy cube rests on the face (centre 0.5 mm out): the contact is 0.5 mm behind it,
      // on the hole axis, at a whole number of pitches from a declared end.
      const matched = ends.some((end) => near(end.position[depth], cad[depth] - 0.0005, 2e-5) &&
        near(Math.abs(end.position[width]), Math.abs(cad[width]), 3e-4) &&
        near(Math.round((cad[1] - end.position[1]) / PITCH) * PITCH, cad[1] - end.position[1], 2e-4))
      assert.ok(matched, `${id} ${marker.node.name} ${cad}`)
    }
  }
})

test('the side panels read their mirror rule from the node name, oriented by the manifest', () => {
  for (const id of ['ysi03036', 'ysi01131']) {
    const rule = production.prepare(id).metadata.rules.find((r) => r.rule === 'mirror-pair')
    assert.deepEqual(rule.axis, [0, 0, -1])
    assert.deepEqual(rule.params.distances, [0.254, 0.507, 0.761, 1.014, 1.268, 1.521])
    // The GLB alone points the rule along the node's +X.
    assert.notDeepEqual(extractRulesFromObject(production.scenes[production.fileOf[id]])[0].extracted.axis, [0, 0, -1])
  }
})

test('the 1014 bay spacing seats every part of the series', () => {
  const context = production.context(WALL)
  const option = pairSpacingOptions('ysi03036', context).find((o) => Math.abs(o.distance - BAY) < 1e-6)
  assert.ok(option)
  for (const part of ['kdw40236', 'kdw40636', 'kld41000', 'xla40400', 'kma40100', 'kcp40531kmd02']) assert.ok(option.fits.includes(item(part).label), part)
})

test('the catalogue check passes on the real folder: samples compose, nothing crosses a flange', () => {
  const report = checkCatalog({ index: production.index, manifest: production.manifest, models: production.scenes })
  assert.equal(report.blocking, false, report.issues.filter((entry) => entry.severity === 'error').map((entry) => entry.message).join('\n'))
  assert.equal(report.summary.samples, 6)
  assert.ok(!report.issues.some((entry) => entry.code === 'sheet-overlap' || entry.code === 'sample-invalid'))
  // The legacy exports are reported for what they are.
  assert.ok(report.issues.some((entry) => entry.code === 'marker-legacy' && entry.file === 'ORIZZONTALI/KDW40236.glb'))
  assert.ok(report.issues.some((entry) => entry.code === 'review-pending'))
})

test('the reference wall is still what the former demo generator produced', () => {
  const catalog = TASCA_CATALOG_GROUPS.flatMap((group) => group.items)
  const regenerated = JSON.parse(serializeProject(buildTascaWall(tascaWallContext(catalog, production.manifest))))
  assert.deepEqual(regenerated, reference)
})

/** The interface's attachment steps: source point, destination part, destination point. */
function attach(editor, source, point, target, targetPoint) {
  const { store, hydrate } = editor
  assert.ok(beginAttachment(store, source), `${source} can start an attachment`)
  assert.ok(chooseAttachmentPoint(store, point), `${source}:${point}`)
  assert.ok(chooseAttachmentTarget(store, target), `${source} → ${target}`)
  const committed = chooseAttachmentPoint(store, targetPoint)
  assert.ok(committed, `${source}:${point} → ${target}:${targetPoint}: ${store.getState().attachment?.error}`)
  hydrate()
}

function add(editor, catalogId) {
  const id = addItemToScene(editor.store, editor.store.getState().catalog[catalogId])
  editor.hydrate()
  return id
}

function pair(editor, id, distance = BAY) {
  setMirrorPairDistance(editor.store, id, distance)
  editor.hydrate()
  return editor.store.getState().project.items.find((entry) => entry.constraints?.some((c) => c.type === 'mirrorPair' && c.target === id)).id
}

/** A drag released at `position`: the live group moves, the release commits it. */
function drag(editor, id, position) {
  const state = editor.store.getState()
  const placed = state.project.items.find((entry) => entry.id === id)
  const height = state.itemSizes[placed.catalogId][1]
  state.itemRegistry.get(id).group.position.set(position[0], position[1] + height / 2, position[2])
  finishItemMovement(editor.store, id, 'translate', placed.rotation, [], [])
  editor.hydrate()
}

/** Compose the quoted wall from an empty scene the way a user does, in the reference order. */
function composeWall() {
  const editor = createEditor(production, { enclosure: ivecoEnclosure })
  const ids = {}
  const at = Object.fromEntries(reference.items.map((entry) => [entry.id, entry]))
  // The lower outer panel: added, turned to face the aisle, dragged into the corner, paired.
  ids['fianco-basso'] = add(editor, 'ysi03036')
  rotateAssembly(editor.store, ids['fianco-basso'], Math.PI)
  drag(editor, ids['fianco-basso'], at['fianco-basso'].position)
  ids['fianco-basso-specchiato'] = pair(editor, ids['fianco-basso'])
  ids['fianco-alto'] = add(editor, 'ysi01131')
  attach(editor, ids['fianco-alto'], 'stack-bottom', ids['fianco-basso'], 'stack-top')
  ids['fianco-alto-specchiato'] = pair(editor, ids['fianco-alto'])
  for (const [id, catalogId, point, on, hole] of [
    ['antina-inferiore', 'kld41000', 'end-a', 'fianco-basso', 'front-11'],
    ['cassetto-208', 'kdw40636', 'end-a', 'fianco-basso', 'front-14'],
    ['cassetto-136', 'kdw40436', 'end-a', 'fianco-basso', 'front-19'],
    ['cassetto-100', 'kdw40336', 'end-a', 'fianco-basso', 'front-23'],
    ['cassetto-64', 'kdw40236', 'end-a', 'fianco-basso', 'front-25'],
    ['angolare-leggero', 'xla40400', 'end-a', 'fianco-basso', 'front-27'],
    ['angolare-anteriore', 'kma40100', 'end-a', 'fianco-alto', 'front-2'],
    ['angolare-posteriore', 'kma40100', 'end-b', 'fianco-alto', 'back-2'],
    ['antina-superiore', 'kud40900', 'end-a', 'fianco-alto', 'front-8'],
    ['cassettiera', 'kdu40426kd080', 'end-a', 'fianco-alto', 'top'],
  ]) {
    ids[id] = add(editor, catalogId)
    attach(editor, ids[id], point, ids[on], hole)
  }
  return { editor, ids }
}

const jointKeys = (project, nameOf) => project.connections.map((c) => [`${nameOf(c.sourceItemId)}:${c.sourcePointId}`, `${nameOf(c.targetItemId)}:${c.targetPointId}`].sort().join(' ↔ ')).sort()

/**
 * The demo wrote CAD values rounded to 0.1 mm (drawer marker depth 179.8 mm,
 * body centre −0.9 mm); the manifest uses the measured ones (179.75, −0.85).
 * Poses therefore agree to 0.2 mm, joints and BOM exactly.
 */
const REFERENCE_TOLERANCE = 2e-4

function assertMatchesReference(project, ids, label) {
  const nameOf = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]))
  assert.equal(project.items.length, reference.items.length, label)
  for (const expected of reference.items) {
    const actual = project.items.find((entry) => entry.id === ids[expected.id])
    expected.position.forEach((value, axis) => assert.ok(near(actual.position[axis], value, REFERENCE_TOLERANCE), `${label} ${expected.id}[${axis}] ${actual.position[axis]} vs ${value}`))
    assert.ok(near(Math.sin(actual.rotation[1]), Math.sin(expected.rotation[1]), 1e-9) && near(Math.cos(actual.rotation[1]), Math.cos(expected.rotation[1]), 1e-9), `${label} ${expected.id} yaw`)
    assert.equal(!!actual.mirrored, !!expected.mirrored, `${label} ${expected.id} mirrored`)
  }
  assert.deepEqual(jointKeys(project, (id) => nameOf[id]), jointKeys(reference, (id) => id), label)
  assert.deepEqual(buildProjectBom(project, production.built.items, production.manifest), referenceBom, label)
}

test('the pilot assembly composes by hand from an empty scene: two sides, a drawer and a door', () => {
  const editor = createEditor(production, { enclosure: ivecoEnclosure })
  const side = add(editor, 'ysi03036')
  const twin = pair(editor, side)
  const drawer = add(editor, 'kdw40236')
  attach(editor, drawer, 'end-a', side, 'front-14')
  const door = add(editor, 'kld41000')
  attach(editor, door, 'end-a', side, 'front-3')
  const project = editor.store.getState().exportProject()
  // Each part at both ends, the far end on the twin: nobody typed a coordinate.
  for (const part of [drawer, door]) {
    assert.deepEqual(project.connections.filter((c) => c.sourceItemId === part || c.targetItemId === part).map((c) => c.sourceItemId === part ? c.targetItemId : c.sourceItemId).sort(), [side, twin].sort())
  }
  const errors = editor.store.getState().validationIssues.filter((issue) => issue.level === 'error' && issue.code !== 'out-of-bounds')
  assert.deepEqual(errors, [])
  // Saved and reopened, nothing moves and every joint is still resolved.
  const reopened = createEditor(production, { enclosure: ivecoEnclosure })
  reopened.store.getState().setProject(parseProject(serializeProject(project), { catalog: production.built.items, catalogRevision: 'rev-test' }).project)
  reopened.hydrate()
  assert.deepEqual(reopened.store.getState().exportProject(), project)
})

test('the quoted wall composes by hand, matches the reference and validates inside the van', () => {
  const { editor, ids } = composeWall()
  const project = editor.store.getState().exportProject()
  assertMatchesReference(project, ids, 'manuale')
  const state = editor.store.getState()
  const issues = validateConfiguration(project, state.catalog, production.manifest, {
    itemSnaps: state.itemSnaps, itemRules: state.itemRules, itemSizes: state.itemSizes, enclosureBounds: state.interiorBBox,
  })
  assert.deepEqual(issues.filter((issue) => issue.level === 'error'), [])
  // Every joint names a connector of the manifest and the catalogue revision is recorded.
  assert.ok(project.connections.every((c) => c.sourceConnectorId && c.targetConnectorId))
  assert.equal(project.catalog.revision, 'rev-test')
})

test('saving and reopening the wall changes no pose, pair, joint or BOM line', () => {
  const { editor, ids } = composeWall()
  const saved = serializeProject(editor.store.getState().exportProject())
  const { project, warnings } = parseProject(saved, { catalog: production.built.items, catalogRevision: 'rev-test' })
  assert.deepEqual(warnings, [])
  const reopened = createEditor(production, { enclosure: ivecoEnclosure })
  reopened.store.getState().setProject(project)
  reopened.hydrate()
  const again = reopened.store.getState().exportProject()
  assertMatchesReference(again, ids, 'riaperto')
  assert.equal(serializeProject(again), saved)
  assert.deepEqual(reopened.store.getState().project.items.flatMap((entry) => entry.constraints ?? []).filter((c) => c.type === 'snapToItem'), [])
})

test('composition operations keep joints and BOM consistent through delete, undo and redo', () => {
  const { editor, ids } = composeWall()
  const { store } = editor
  const before = store.getState().exportProject()
  const bomOf = () => buildProjectBom(store.getState().exportProject(), production.built.items, production.manifest)
  const count = (code) => bomOf().find((line) => line.code === code)?.quantity ?? 0
  store.getState().removeItem(ids['cassetto-64'])
  editor.hydrate()
  assert.equal(store.getState().project.connections.length, 20)
  assert.equal(count('KDW40236'), 0)
  // One half of a pair takes its twin along, and the parts lose their joints with both.
  store.getState().removeItem(ids['fianco-alto'])
  editor.hydrate()
  assert.ok(!store.getState().project.items.some((entry) => entry.id === ids['fianco-alto-specchiato']))
  assert.equal(count('YSI01131'), 0)
  assert.ok(store.getState().project.connections.every((c) => store.getState().project.items.some((entry) => entry.id === c.sourceItemId) && store.getState().project.items.some((entry) => entry.id === c.targetItemId)))
  store.getState().undo()
  store.getState().undo()
  editor.hydrate()
  assert.deepEqual(store.getState().exportProject(), before)
  store.getState().redo()
  editor.hydrate()
  assert.equal(count('KDW40236'), 0)
  // Moving the assembly moves every part rigidly, with one undo entry.
  store.getState().undo()
  editor.hydrate()
  const steps = store.getState().past.length
  const moved = [...reference.items.find((entry) => entry.id === 'fianco-basso').position]
  moved[2] += 0.05
  drag(editor, ids['fianco-basso'], moved)
  assert.equal(store.getState().past.length, steps + 1)
  const shifted = store.getState().exportProject()
  for (const entry of before.items) {
    const now = shifted.items.find((candidate) => candidate.id === entry.id)
    assert.ok(near(now.position[2] - entry.position[2], 0.05, 1e-9) && near(now.position[0], entry.position[0], 1e-9), entry.id)
  }
  assert.equal(shifted.connections.length, before.connections.length)
})

test('the attachment explains why a point cannot take a part: occupied, family, bay, collision', () => {
  const { editor, ids } = composeWall()
  const { store } = editor
  const state = () => store.getState()
  const drawer = add(editor, 'kdw40236')
  const statusOf = (target, sourcePoint, hole, source = drawer) => attachmentPointStates(state(), target, { itemId: source, pointId: sourcePoint }).find((entry) => entry.point.id === hole)
  assert.equal(statusOf(ids['fianco-basso'], 'end-a', 'front-14').status, 'occupied')
  assert.equal(statusOf(ids['fianco-basso'], 'end-a', 'front-2').status, 'free')
  // Heights are measured from the cargo floor: hole 2 of the lower panel is 54 mm above its base.
  assert.equal(statusOf(ids['fianco-basso'], 'end-a', 'front-2').heightMm, Math.round((0.012 + 0.054) * 1000))
  const box = add(editor, 'kdu40426kd080')
  assert.equal(statusOf(ids['fianco-basso'], 'end-a', 'front-2', box).status, 'incompatible')
  // A pair at another spacing does not take a 1014 part.
  const lone = add(editor, 'ysi03036')
  drag(editor, lone, [-0.4, 0.012, -1.2])
  pair(editor, lone, 1.268)
  assert.equal(statusOf(lone, 'end-a', 'front-5').status, 'bay-not-allowed')
  assert.match(computeAttachmentPreview(state(), drawer, 'end-a', lone, 'front-5').error, /Campata non ammessa/)
  // A free hole whose seat would put the drawer into the one below is a collision.
  const preview = computeAttachmentPreview(state(), drawer, 'end-a', ids['fianco-basso'], 'front-15')
  assert.equal(preview.valid, false)
  assert.equal(preview.reason, 'collision')
})

test('a part hung on the reference wall stays behind the flange in the scene too', () => {
  const { editor, ids } = composeWall()
  const state = editor.store.getState()
  const side = state.project.items.find((entry) => entry.id === ids['fianco-basso'])
  const hole = snapsForItem(side, state.itemSnaps, state.itemRules).find((point) => point.id === 'front-14')
  // The panel faces -X here (turned 180°): the flange's outer face is 1.5 mm in front of the hole.
  const holeWorld = worldPoint(side, hole.position, state.itemSizes.ysi03036[1])
  const outer = side.position[0] - 0.363 / 2
  assert.ok(near(holeWorld[0], outer + SHEET, 1e-6))
  const sideBox = new Box3().setFromCenterAndSize(new Vector3(side.position[0], side.position[1] + 0.54, side.position[2]), new Vector3(0.363, 1.08, 0.029))
  assert.ok(sideBox.containsPoint(new Vector3(...holeWorld)))
})
