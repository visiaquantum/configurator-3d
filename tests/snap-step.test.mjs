import { beforeAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { beginAttachment, chooseAttachmentPoint, chooseAttachmentTarget, confirmAttachment, selectAttachmentPoint, setMirrorPairDistance, snapStepPreview, stepItemSnap, parseProject, serializeProject } from '../src/lib/index.ts'
import { addItemToScene } from '../src/lib/scene/commands.ts'
import { createEditor, loadProductionCatalog } from './helpers/production.mjs'

let production
beforeAll(async () => { production = await loadProductionCatalog() })
function setup({ pair = true, hole = 14, kind = 'kdw40236', sourcePoint = 'end-a', prefix = 'front' } = {}) {
  const editor = createEditor(production)
  const add = (catalogId) => { const id = addItemToScene(editor.store, editor.store.getState().catalog[catalogId]); editor.hydrate(); return id }
  const side = add('ysi03036')
  if (pair) { setMirrorPairDistance(editor.store, side, 1.014); editor.hydrate() }
  const part = add(kind)
  const attach = (id, pointId, row) => {
    assert.equal(beginAttachment(editor.store, id), true)
    assert.equal(chooseAttachmentPoint(editor.store, pointId), true)
    assert.equal(chooseAttachmentTarget(editor.store, side), true)
    assert.equal(chooseAttachmentPoint(editor.store, row), true, editor.store.getState().attachment?.error)
    editor.hydrate()
  }
  attach(part, sourcePoint, `${prefix}-${hole}`)
  return { ...editor, add, attach, side, part }
}

test('one step moves both drawer ends, holds the frame fixed and creates one undo entry', () => {
  const e = setup(), state = () => e.store.getState()
  const before = state().exportProject(), history = state().past.length
  assert.equal(before.connections.length, 2)
  assert.equal(stepItemSnap(e.store, e.part, 1), true)
  const after = state().exportProject()
  assert.equal(state().past.length, history + 1)
  const old = before.items.find((p) => p.id === e.part), moved = after.items.find((p) => p.id === e.part)
  assert.ok(Math.abs(moved.position[1] - old.position[1] - 0.036) < 1e-7)
  assert.equal(moved.position[0], old.position[0]); assert.equal(moved.position[2], old.position[2])
  assert.ok(after.connections.every((joint) => joint.targetPointId === 'front-15'))
  for (const side of before.items.filter((p) => p.id !== e.part)) assert.deepEqual(after.items.find((p) => p.id === side.id), side)
  state().undo(); assert.deepEqual(state().exportProject(), before)
  state().redo(); assert.deepEqual(state().exportProject(), after)
  assert.equal(serializeProject(parseProject(serializeProject(after), { catalog: production.built.items }).project), serializeProject(after))
  assert.equal(stepItemSnap(e.store, e.part, -1), true)
  const returned = state().exportProject()
  assert.ok(Math.abs(returned.items.find((p) => p.id === e.part).position[1] - old.position[1]) < 1e-9)
  assert.ok(returned.connections.every((joint) => joint.targetPointId === 'front-14'))
})

test('collision at the adjacent hole blocks the step without skipping or changing history', () => {
  const e = setup()
  const other = e.add('kdw40236'); e.attach(other, 'end-a', 'front-16')
  const before = e.store.getState().exportProject(), history = e.store.getState().past.length
  assert.equal(snapStepPreview(e.store.getState(), e.part, 1).valid, false)
  assert.equal(stepItemSnap(e.store, e.part, 1), false)
  assert.deepEqual(e.store.getState().exportProject(), before)
  assert.equal(e.store.getState().past.length, history)
  assert.equal(stepItemSnap(e.store, e.part, -1), true)
  assert.deepEqual(e.store.getState().project.items.find((p) => p.id === other).position, before.items.find((p) => p.id === other).position)
})

test('an occupied adjacent hole on either support blocks the whole operation', () => {
  const e = setup()
  const project = structuredClone(e.store.getState().project)
  const twinJoint = project.connections.find((j) => j.targetItemId !== e.side)
  const other = { ...project.items.find((p) => p.id === e.part), id: 'occupier', position: [4, 0, 0] }
  project.items.push(other)
  project.connections.push({ ...twinJoint, sourceItemId: 'occupier', targetPointId: 'front-15' })
  e.store.getState().setProject(project); e.hydrate()
  const before = e.store.getState().exportProject()
  assert.match(snapStepPreview(e.store.getState(), e.part, 1).error, /occupato/)
  assert.equal(stepItemSnap(e.store, e.part, 1), false)
  assert.deepEqual(e.store.getState().exportProject(), before)
})

test('row limits, readonly and locks refuse the command; support locks do not move the frame', () => {
  const e = setup({ hole: 30 })
  assert.match(snapStepPreview(e.store.getState(), e.part, 1).error, /Ultimo foro/)
  e.store.setState({ readOnly: true }); assert.equal(stepItemSnap(e.store, e.part, -1), false)
  e.store.setState({ readOnly: false }); e.store.getState().updateItem(e.part, { locked: true })
  assert.equal(stepItemSnap(e.store, e.part, -1), false)
  e.store.getState().updateItem(e.part, { locked: false }); e.store.getState().updateItem(e.side, { locked: true })
  assert.equal(stepItemSnap(e.store, e.part, -1), true)
  assert.equal(snapStepPreview(e.store.getState(), e.side, 1), null)
})

test('EXT accessories keep their series, and tilted or inconsistent support steps are rejected', () => {
  const e = setup({ pair: false, kind: 'ptbm31', sourcePoint: 'frontale', prefix: 'front-ext' })
  assert.equal(stepItemSnap(e.store, e.part, 1), true)
  assert.equal(e.store.getState().project.connections[0].targetPointId, 'front-ext-15')
  e.store.getState().updateItem(e.side, { rotation: [0, 0, Math.PI / 2] })
  assert.match(snapStepPreview(e.store.getState(), e.part, 1).error, /verticale/)
  const paired = setup()
  const twin = paired.store.getState().project.items.find((p) => p.mirrored)
  const state = paired.store.getState()
  const altered = structuredClone(state.itemSnaps.ysi03036)
  altered.find((point) => point.id === 'front-15').position[1] += 0.001
  const project = { ...state.project, items: state.project.items.map((item) => item.id === twin.id ? { ...item, catalogId: 'other-pitch' } : item) }
  const context = { ...state, project,
    catalog: { ...state.catalog, 'other-pitch': { ...state.catalog.ysi03036, id: 'other-pitch' } },
    itemSnaps: { ...state.itemSnaps, 'other-pitch': altered },
    itemRules: { ...state.itemRules, 'other-pitch': state.itemRules.ysi03036 },
    itemSizes: { ...state.itemSizes, 'other-pitch': state.itemSizes.ysi03036 },
  }
  assert.match(snapStepPreview(context, paired.part, 1).error, /passi diversi/)
  const mounted = state.project.items.find((item) => item.id === paired.part)
  const maxY = mounted.position[1] + state.itemSizes.kdw40236[1] + 0.01
  assert.equal(snapStepPreview({ ...state, interiorBBox: { min: [-10, 0, -10], max: [10, maxY, 10] } }, paired.part, 1).valid, false)
})

test('destination selection previews without committing; confirm rechecks and cancel keeps the project', () => {
  const e = setup()
  const fresh = e.add('kdw40236')
  beginAttachment(e.store, fresh); selectAttachmentPoint(e.store, 'end-a'); chooseAttachmentTarget(e.store, e.side)
  const before = e.store.getState().exportProject(), history = e.store.getState().past.length
  selectAttachmentPoint(e.store, 'front-20')
  assert.equal(e.store.getState().attachment.selectedPointId, 'front-20')
  assert.deepEqual(e.store.getState().exportProject(), before)
  assert.equal(e.store.getState().past.length, history)
  e.store.getState().setAttachment({ ...e.store.getState().attachment, hoveredPointId: 'front-21' })
  assert.equal(confirmAttachment(e.store), true)
  assert.ok(e.store.getState().project.connections.some((joint) => joint.sourceItemId === fresh && joint.targetPointId === 'front-20'))
  assert.equal(e.store.getState().attachment, null)
  assert.equal(e.store.getState().past.length, history + 1)
})

test('cancelling a destination preview leaves poses, joints and history unchanged', () => {
  const e = setup()
  const fresh = e.add('kdw40236')
  beginAttachment(e.store, fresh); selectAttachmentPoint(e.store, 'end-a'); chooseAttachmentTarget(e.store, e.side)
  const before = e.store.getState().exportProject(), history = e.store.getState().past.length
  selectAttachmentPoint(e.store, 'front-20')
  e.store.getState().setAttachment(null)
  assert.deepEqual(e.store.getState().exportProject(), before)
  assert.equal(e.store.getState().past.length, history)
})

test('stepping also updates a joint recorded from the mirrored support to the drawer', () => {
  const e = setup()
  const project = structuredClone(e.store.getState().project)
  const index = project.connections.findIndex((joint) => joint.targetItemId !== e.side)
  const joint = project.connections[index]
  const side = project.items.find((item) => item.id === joint.targetItemId)
  project.connections[index] = {
    sourceItemId: joint.targetItemId, sourcePointId: joint.targetPointId, sourceConnectorId: joint.targetConnectorId,
    targetItemId: joint.sourceItemId, targetPointId: joint.sourcePointId, targetConnectorId: joint.sourceConnectorId,
    resolvedTransform: { position: side.position, rotation: side.rotation },
  }
  e.store.getState().setProject(project); e.hydrate()
  assert.equal(stepItemSnap(e.store, e.part, 1), true)
  const connections = e.store.getState().project.connections
  assert.equal(connections.length, 2)
  assert.equal(connections.find((entry) => entry.sourceItemId === side.id).sourcePointId, 'front-15')
  assert.equal(connections.find((entry) => entry.targetItemId === e.side).targetPointId, 'front-15')
})
