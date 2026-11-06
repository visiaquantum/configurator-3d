// Minimal GLB writer for tests: every node is an axis-aligned box (or an
// Empty), so a test can build a "CAD export" with exactly the node names,
// duplicates and positions it needs, and read it back through GLTFLoader.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const BOX_INDICES = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]

function boxVertices([x0, y0, z0], [x1, y1, z1]) {
  return [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]
}

/**
 * `nodes`: `{ name, min, max }` for a box, `{ name, position }` for an Empty,
 * `{ name, extras }` for glTF extras. Returns the GLB bytes.
 */
export function makeGlb(nodes) {
  const json = { asset: { version: '2.0', generator: 'test' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] }
  const chunks = []
  let offset = 0
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer.slice(0))
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
    chunks.push(bytes)
    offset += bytes.length
    while (offset % 4) { chunks.push(new Uint8Array(1)); offset++ }
    return json.bufferViews.length - 1
  }
  for (const node of nodes) {
    const entry = { name: node.name, ...(node.extras ? { extras: node.extras } : {}), ...(node.position ? { translation: node.position } : {}) }
    if (node.min) {
      const vertices = new Float32Array(boxVertices(node.min, node.max))
      const position = json.accessors.push({ bufferView: push(vertices, 34962), componentType: 5126, count: 8, type: 'VEC3', min: node.min, max: node.max }) - 1
      const indices = json.accessors.push({ bufferView: push(new Uint16Array(BOX_INDICES), 34963), componentType: 5123, count: 36, type: 'SCALAR' }) - 1
      entry.mesh = json.meshes.push({ primitives: [{ attributes: { POSITION: position }, indices }] }) - 1
    }
    json.nodes.push(entry)
  }
  const bin = new Uint8Array(offset)
  let at = 0
  for (const chunk of chunks) { bin.set(chunk, at); at += chunk.length }
  json.buffers.push({ byteLength: bin.length })
  let text = new TextEncoder().encode(JSON.stringify(json))
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20)
  padded.set(text)
  text = padded
  const total = 12 + 8 + text.length + 8 + bin.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true)
  view.setUint32(12, text.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(text, 20)
  view.setUint32(20 + text.length, bin.length, true); view.setUint32(24 + text.length, 0x004e4942, true); out.set(bin, 28 + text.length)
  return out
}

export function parseGlb(bytes) {
  return new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', (gltf) => resolve(gltf.scene), reject))
}

/** A 1 mm marker cube centred on `center`. */
export const marker = (name, center) => ({ name, min: center.map((v) => v - 0.0005), max: center.map((v) => v + 0.0005) })
