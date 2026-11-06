import { test } from 'vitest'
import assert from 'node:assert/strict'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Box3 } from 'three'
import { extractAnchorsFromGLB } from '../src/lib/io/anchors.ts'
import { orient, parseStl, simplify, weld, writeGlb, guessUnit } from '../src/tools/stlToGlb/core.ts'

/** Binary STL of a closed box in millimetres, Z up: `w` along X, `d` along Y, `h` along Z. */
function boxStl(w, d, h) {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]]
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  const buffer = new ArrayBuffer(84 + faces.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, faces.length, true)
  faces.forEach((face, t) => face.forEach((index, k) => v[index].forEach((value, axis) => view.setFloat32(84 + t * 50 + 12 + (k * 3 + axis) * 4, value, true))))
  return buffer
}

test('STL in mm, Z up, becomes a GLB in metres, Y up, centred on the floor', async () => {
  const raw = parseStl(boxStl(2000, 4000, 1800))
  assert.equal(raw.length, 12 * 9)
  assert.equal(guessUnit(raw), 'mm')
  const welded = weld(orient(raw, { unit: 'mm', up: 'z', quarterTurns: 0, centerOnFloor: true }))
  assert.equal(welded.positions.length / 3, 8)
  assert.equal(welded.indices.length / 3, 12)
  const mesh = await simplify(welded, 12, false)
  const glb = writeGlb(mesh, 'FURGONE')

  const gltf = await new GLTFLoader().parseAsync(glb.buffer, '')
  assert.equal(gltf.scene.children[0].name, 'FURGONE')
  const box = new Box3().setFromObject(gltf.scene)
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} ≠ ${b}`)
  near(box.min.y, 0); near(box.max.y, 1.8)
  near(box.min.x, -1); near(box.max.x, 1)
  near(box.min.z, -2); near(box.max.z, 2)
})

test('a quarter turn swaps the horizontal axes and simplify honours the target', async () => {
  const welded = weld(orient(parseStl(boxStl(2000, 4000, 1800)), { unit: 'mm', up: 'z', quarterTurns: 1, centerOnFloor: true }))
  const xs = [], zs = []
  for (let i = 0; i < welded.positions.length; i += 3) { xs.push(welded.positions[i]); zs.push(welded.positions[i + 2]) }
  assert.ok(Math.abs(Math.max(...xs) - 2) < 1e-5)
  assert.ok(Math.abs(Math.max(...zs) - 1) < 1e-5)
  const reduced = await simplify(welded, 6, false)
  assert.ok(reduced.indices.length / 3 <= 12)
  assert.equal(reduced.normals.length, reduced.positions.length)
})

test('snap points become anchor_<id> nodes the configurator reads back', async () => {
  const mesh = await simplify(weld(orient(parseStl(boxStl(2000, 4000, 1800)), { unit: 'mm', up: 'z', quarterTurns: 0, centerOnFloor: true })), 12, false)
  const anchors = [
    { id: 'pavimento-1', position: [0.85, 0, 1.2], normal: [0, 1, 0] },
    { id: 'parete_sx', position: [-1, 1.1, 0], normal: [1, 0, 0] },
  ]
  const gltf = await new GLTFLoader().parseAsync(writeGlb(mesh, 'FURGONE', anchors).buffer, '')
  assert.deepEqual(extractAnchorsFromGLB(gltf.scene), anchors)
  assert.throws(() => writeGlb(mesh, 'FURGONE', [{ id: 'non valido', position: [0, 0, 0], normal: [0, 1, 0] }]), /non valido/)
})
