import { test } from 'vitest'
import assert from 'node:assert/strict'
import { Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Vector3 } from 'three'
import { ISOMETRIC_VIEWS, defaultIsometricViews, exportIsometricSheetPDF, parseProject } from '../src/lib/index.ts'
import { frameIsometricCamera, isometricOffset, projectedRect } from '../src/lib/scene/isometric.ts'
import { buildDrawingScene } from '../src/lib/io/technicalDrawing.ts'
import { createEnclosureCutaway } from '../src/lib/scene/enclosureCutaway.ts'
import { isometricSheetImageSize } from '../src/lib/io/isometricSheet.ts'

// The IVECO van of the quote: X is the width, Z the length.
const van = { min: [-0.905, 0, -1.6], max: [0.905, 2.1, 1.6] }

test('default views look at the products from the opposite side of the van', () => {
  const rightWall = { min: [0.7, 0, 0.2], max: [0.9, 1.6, 1.2] }
  assert.deepEqual(defaultIsometricViews(van, rightWall), ['iso-front-left', 'iso-back-left'])
  const leftWall = { min: [-0.9, 0, -1], max: [-0.7, 1.6, 0] }
  assert.deepEqual(defaultIsometricViews(van, leftWall), ['iso', 'iso-back-right'])
  // Products on both sides, or none: every view is useful.
  assert.deepEqual(defaultIsometricViews(van, { min: [-0.9, 0, 0], max: [0.9, 1, 1] }), [...ISOMETRIC_VIEWS])
  assert.deepEqual(defaultIsometricViews(van, null), [...ISOMETRIC_VIEWS])
  // An enclosure longer along X takes Z as its width.
  const turned = { min: [-1.6, 0, -0.9], max: [1.6, 2, 0.9] }
  assert.deepEqual(defaultIsometricViews(turned, { min: [-1, 0, 0.7], max: [0, 1, 0.9] }), ['iso-back-right', 'iso-back-left'])
})

test('the isometric camera looks along a true diagonal and frames the bounds', () => {
  const bounds = new Box3(new Vector3(...van.min), new Vector3(...van.max))
  for (const view of ISOMETRIC_VIEWS) {
    const camera = frameIsometricCamera(new OrthographicCamera(), view, bounds, 1.67)
    const direction = camera.getWorldDirection(new Vector3())
    const axes = direction.toArray().map(Math.abs)
    assert.ok(Math.max(...axes) - Math.min(...axes) < 1e-9, view)
    assert.ok(direction.dot(isometricOffset(view)) < -0.999, view)
    assert.ok(Math.abs((camera.right - camera.left) / (camera.top - camera.bottom) - 1.67) < 1e-9)
    for (const x of [van.min[0], van.max[0]]) for (const y of [van.min[1], van.max[1]]) for (const z of [van.min[2], van.max[2]]) {
      const p = new Vector3(x, y, z).project(camera)
      assert.ok(Math.abs(p.x) <= 0.93 && Math.abs(p.y) <= 0.93 && Math.abs(p.z) < 1, `${view} ${p.toArray()}`)
    }
    const rect = projectedRect(bounds, camera, 1000, 600)
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1000 && rect.y + rect.height <= 600)
  }
})

/** Floor, roof and four walls of a 2 × 2 × 4 box, one quad each. */
function shell() {
  const quads = {
    floor: [[-1, 0, -2], [1, 0, -2], [1, 0, 2], [-1, 0, 2]],
    roof: [[-1, 2, -2], [-1, 2, 2], [1, 2, 2], [1, 2, -2]],
    right: [[1, 0, -2], [1, 2, -2], [1, 2, 2], [1, 0, 2]],
    left: [[-1, 0, -2], [-1, 0, 2], [-1, 2, 2], [-1, 2, -2]],
    front: [[-1, 0, 2], [1, 0, 2], [1, 2, 2], [-1, 2, 2]],
    back: [[-1, 0, -2], [-1, 2, -2], [1, 2, -2], [1, 0, -2]],
  }
  const positions = []
  for (const [a, b, c, d] of Object.values(quads)) positions.push(...a, ...b, ...c, ...a, ...c, ...d)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const root = new Group()
  root.add(new Mesh(geometry, new MeshBasicMaterial()))
  return root
}

test('the roof is cut only on request', () => {
  const root = shell()
  const mesh = root.children[0]
  const bounds = new Box3(new Vector3(-1, 0, -2), new Vector3(1, 2, 2))
  const cutaway = createEnclosureCutaway(root, bounds)
  const camera = frameIsometricCamera(new OrthographicCamera(), 'iso-front-left', bounds, 1.5)
  cutaway.update(camera, true)
  // The left and front walls face the camera: 6 faces less 2, 2 triangles each.
  assert.equal(mesh.geometry.index.count / 3, 8)
  cutaway.update(camera, true, true)
  assert.equal(mesh.geometry.index.count / 3, 6)
  cutaway.dispose()
  assert.equal(mesh.geometry.index, null)
})

test('the drawing scene copies the live meshes without touching them', () => {
  const enclosure = shell()
  const live = enclosure.children[0].geometry
  const item = new Group()
  item.position.set(0.7, 0.5, 0)
  const body = new Mesh(new BoxGeometry(0.2, 1, 1), new MeshBasicMaterial())
  const helper = new Mesh(new BoxGeometry(5, 5, 5), new MeshBasicMaterial())
  helper.userData.configuratorHelper = true
  item.add(body, helper)
  const enclosureBounds = new Box3(new Vector3(-1, 0, -2), new Vector3(1, 2, 2))
  const drawing = buildDrawingScene({ enclosureRoots: [enclosure], itemRoots: [item], enclosureBounds, view: 'iso-front-left', width: 1200, height: 720 })
  try {
    // The helper is neither drawn nor counted in the products' bounds.
    assert.deepEqual(drawing.itemBounds.min.toArray().map((v) => +v.toFixed(6)), [0.6, 0, -0.5])
    assert.deepEqual(drawing.itemBounds.max.toArray().map((v) => +v.toFixed(6)), [0.8, 1, 0.5])
    const faces = drawing.scene.children.filter((child) => child.isMesh && !child.isLineSegments2)
    const edges = drawing.scene.children.filter((child) => child.isLineSegments2)
    assert.equal(faces.length, 2)
    assert.equal(edges.length, 2)
    // The box keeps its 12 edges; the enclosure copy is cut (no roof, left or front wall).
    assert.equal(edges[0].geometry.instanceCount ?? edges[0].geometry.attributes.instanceStart.count, 12)
    assert.equal(faces[1].geometry.index.count / 3, 6)
    assert.equal(enclosure.children[0].geometry, live)
    assert.equal(body.material.type, 'MeshBasicMaterial')
    assert.ok(faces.every((face) => face.material.polygonOffset))
  } finally {
    drawing.dispose()
  }
})

test('isometric sheets: one A4 landscape page per view with the quote title block', async () => {
  // 1 × 1 white PNG.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
  const project = { id: 'tasca', version: 1, enclosure: { glbUrl: '/van.glb' }, items: [], metadata: { name: 'Parete', customer: 'Cliente', quoteNumber: '99003819', vehicle: 'IVECO Daily 2014 L3 H2' } }
  const blob = await exportIsometricSheetPDF({ project, views: [{ label: 'Vista A', dataUrl: png, width: 1, height: 1 }, { label: 'Vista B', dataUrl: png, width: 1, height: 1 }], date: new Date('2026-11-05T12:00:00Z') })
  const content = await blob.text()
  assert.equal((content.match(/\/Type \/Page\b/g) ?? []).length, 2)
  assert.match(content, /\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/)
  for (const text of ['Nr. 99003819', 'IVECO Daily 2014 L3 H2', 'Tavola 2 di 2']) assert.ok(content.includes(text), text)
  await assert.rejects(exportIsometricSheetPDF({ project, views: [] }), /Nessuna vista/)
  const { width, height } = isometricSheetImageSize()
  assert.equal(width, 2400)
  assert.ok(Math.abs(width / height - 271 / 162) < 0.01)
})

test('quote number and vehicle survive the project round trip', () => {
  const { project } = parseProject({ id: 'p', version: 1, enclosure: { glbUrl: '/van.glb' }, items: [], metadata: { quoteNumber: '99003819', vehicle: 'IVECO' } })
  assert.equal(project.metadata.quoteNumber, '99003819')
  assert.equal(project.metadata.vehicle, 'IVECO')
})
