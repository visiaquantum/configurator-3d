/**
 * STL → GLB conversion for vehicle surveys: parse, orient to the configurator
 * frame (metres, +Y up, origin at the centre of the floor), weld, simplify
 * with meshoptimizer and write a single-mesh GLB. No DOM: runs in a worker
 * and in Node.
 */
import { MeshoptSimplifier } from 'meshoptimizer'

export type StlUnit = 'mm' | 'cm' | 'm'
export type UpAxis = 'z' | 'y'

export interface OrientOptions {
  unit: StlUnit
  up: UpAxis
  /** Quarter turns around the vertical axis, applied after the up-axis fix. */
  quarterTurns: number
  /** Centre X/Z on the origin and put the lowest point at Y = 0. */
  centerOnFloor: boolean
}

export interface IndexedMesh {
  positions: Float32Array
  indices: Uint32Array
}

export interface SimplifiedMesh extends IndexedMesh {
  normals: Float32Array
  /** Largest deviation from the welded mesh, in metres. */
  error: number
}

/** A snap point of the enclosure, written as an `anchor_<id>` node (see `io/anchors.ts`). */
export interface GlbAnchor {
  id: string
  /** Metres, in the GLB frame. */
  position: [number, number, number]
  normal: [number, number, number]
}

/** Anchor ids the configurator reads back unchanged from a node name. */
export const ANCHOR_ID_RE = /^[A-Za-z0-9_-]+$/

export const UNIT_SCALE: Record<StlUnit, number> = { mm: 0.001, cm: 0.01, m: 1 }

/** Unindexed triangle positions (9 floats per triangle) of a binary or ASCII STL. */
export function parseStl(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer)
  if (buffer.byteLength >= 84) {
    const count = view.getUint32(80, true)
    if (84 + count * 50 === buffer.byteLength) {
      const out = new Float32Array(count * 9)
      for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12
        for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(base + k * 4, true)
      }
      return out
    }
  }
  const text = new TextDecoder().decode(buffer)
  if (!/^\s*solid/.test(text)) throw new Error('Il file non è un STL valido (né binario né ASCII)')
  const values: number[] = []
  const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
  for (let match = vertex.exec(text); match; match = vertex.exec(text)) values.push(+match[1], +match[2], +match[3])
  if (values.length === 0 || values.length % 9 !== 0) throw new Error('STL ASCII senza triangoli leggibili')
  return Float32Array.from(values)
}

/** Axis-aligned bounds of a position array. */
export function boundsOf(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}

/** Best guess of the file unit from its largest extent (a van is 1–8 m). */
export function guessUnit(positions: Float32Array): StlUnit {
  const { min, max } = boundsOf(positions)
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  return extent > 100 ? 'mm' : extent > 20 ? 'cm' : 'm'
}

/** A copy of the triangles in the configurator frame. */
export function orient(source: Float32Array, options: OrientOptions): Float32Array {
  const out = new Float32Array(source.length)
  const scale = UNIT_SCALE[options.unit]
  const turns = ((options.quarterTurns % 4) + 4) % 4
  for (let i = 0; i < source.length; i += 3) {
    let x = source[i] * scale
    let y = source[i + 1] * scale
    let z = source[i + 2] * scale
    // Z-up (CAD, scanners) → Y-up: (x, y, z) → (x, z, -y).
    if (options.up === 'z') { const t = y; y = z; z = -t }
    for (let q = 0; q < turns; q++) { const t = x; x = z; z = -t }
    out[i] = x
    out[i + 1] = y
    out[i + 2] = z
  }
  if (options.centerOnFloor) {
    const { min, max } = boundsOf(out)
    const cx = (min[0] + max[0]) / 2
    const cz = (min[2] + max[2]) / 2
    for (let i = 0; i < out.length; i += 3) {
      out[i] -= cx
      out[i + 1] -= min[1]
      out[i + 2] -= cz
    }
  }
  return out
}

/**
 * Merge vertices closer than `tolerance` (metres) and drop the triangles that
 * collapse. STL repeats every vertex per triangle; simplification needs the
 * shared topology.
 */
export function weld(triangles: Float32Array, tolerance = 1e-5): IndexedMesh {
  const vertexCount = triangles.length / 3
  let capacity = 1
  while (capacity < vertexCount * 2) capacity <<= 1
  const mask = capacity - 1
  const table = new Int32Array(capacity).fill(-1)
  const keys = new Int32Array(vertexCount * 3)
  const positions = new Float32Array(vertexCount * 3)
  const remap = new Uint32Array(vertexCount)
  let unique = 0
  const inv = 1 / tolerance
  for (let v = 0; v < vertexCount; v++) {
    const qx = Math.round(triangles[v * 3] * inv)
    const qy = Math.round(triangles[v * 3 + 1] * inv)
    const qz = Math.round(triangles[v * 3 + 2] * inv)
    let slot = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) & mask
    for (;;) {
      const entry = table[slot]
      if (entry === -1) {
        table[slot] = unique
        keys[unique * 3] = qx
        keys[unique * 3 + 1] = qy
        keys[unique * 3 + 2] = qz
        positions[unique * 3] = triangles[v * 3]
        positions[unique * 3 + 1] = triangles[v * 3 + 1]
        positions[unique * 3 + 2] = triangles[v * 3 + 2]
        remap[v] = unique++
        break
      }
      if (keys[entry * 3] === qx && keys[entry * 3 + 1] === qy && keys[entry * 3 + 2] === qz) {
        remap[v] = entry
        break
      }
      slot = (slot + 1) & mask
    }
  }
  const indices = new Uint32Array(vertexCount)
  let count = 0
  for (let t = 0; t < vertexCount; t += 3) {
    const a = remap[t], b = remap[t + 1], c = remap[t + 2]
    if (a === b || b === c || a === c) continue
    indices[count++] = a
    indices[count++] = b
    indices[count++] = c
  }
  return { positions: positions.slice(0, unique * 3), indices: indices.slice(0, count) }
}

/** Keep only the vertices the indices use, in first-use order. */
export function compact(mesh: IndexedMesh): IndexedMesh {
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1)
  const indices = new Uint32Array(mesh.indices.length)
  let next = 0
  for (let i = 0; i < mesh.indices.length; i++) {
    const old = mesh.indices[i]
    if (remap[old] === -1) remap[old] = next++
    indices[i] = remap[old]
  }
  const positions = new Float32Array(next * 3)
  for (let old = 0; old < remap.length; old++) {
    const target = remap[old]
    if (target === -1) continue
    positions[target * 3] = mesh.positions[old * 3]
    positions[target * 3 + 1] = mesh.positions[old * 3 + 1]
    positions[target * 3 + 2] = mesh.positions[old * 3 + 2]
  }
  return { positions, indices }
}

/** Area-weighted smooth vertex normals. */
export function vertexNormals(mesh: IndexedMesh): Float32Array {
  const { positions: p, indices } = mesh
  const normals = new Float32Array(p.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const v of [a, b, c]) { normals[v] += nx; normals[v + 1] += ny; normals[v + 2] += nz }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length
  }
  return normals
}

/**
 * Reduce the welded mesh to about `targetTriangles`. `prune` also removes
 * small disconnected fragments (scan noise). The error is reported in metres.
 */
export async function simplify(mesh: IndexedMesh, targetTriangles: number, prune: boolean): Promise<SimplifiedMesh> {
  await MeshoptSimplifier.ready
  const target = Math.max(3, Math.min(mesh.indices.length, Math.round(targetTriangles) * 3))
  let indices = mesh.indices
  let relative = 0
  if (target < mesh.indices.length || prune) {
    const [result, error] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, 1, prune ? ['Prune'] : [])
    indices = result
    relative = error
  }
  const reduced = compact({ positions: mesh.positions, indices })
  const scale = MeshoptSimplifier.getScale(mesh.positions, 3)
  return { ...reduced, normals: vertexNormals(reduced), error: relative * scale }
}

/** Byte size of the GLB `writeGlb` would produce for this mesh. */
export function glbByteLength(vertexCount: number, indexCount: number): number {
  const indexBytes = indexCount * (vertexCount > 65535 ? 4 : 2)
  return 20 + 1200 + 8 + vertexCount * 24 + Math.ceil(indexBytes / 4) * 4
}

const align4 = (n: number) => Math.ceil(n / 4) * 4

/**
 * A single-mesh, single-material GLB in metres, +Y up, plus one empty node
 * `anchor_<id>` per snap point (position = node translation, normal in
 * `extras.normal`), the convention `io/anchors.ts` reads.
 */
export function writeGlb(mesh: SimplifiedMesh, name: string, anchors: GlbAnchor[] = []): Uint8Array {
  for (const anchor of anchors) if (!ANCHOR_ID_RE.test(anchor.id)) throw new Error(`Nome del punto non valido: ${anchor.id}`)
  const vertexCount = mesh.positions.length / 3
  const wide = vertexCount > 65535
  const indexData = wide ? mesh.indices : Uint16Array.from(mesh.indices)
  const { min, max } = boundsOf(mesh.positions)
  const positionBytes = mesh.positions.byteLength
  const normalBytes = mesh.normals.byteLength
  const indexBytes = indexData.byteLength
  const binLength = positionBytes + normalBytes + align4(indexBytes)
  const json = {
    asset: { version: '2.0', generator: 'configurator-3d stl-to-glb' },
    scene: 0,
    scenes: [{ nodes: [0, ...anchors.map((_, i) => i + 1)] }],
    nodes: [
      { name, mesh: 0 },
      ...anchors.map((anchor) => ({ name: `anchor_${anchor.id}`, translation: anchor.position, extras: { kind: 'anchor', id: anchor.id, normal: anchor.normal } })),
    ],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Rilievo', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.78, 0.79, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: binLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes, byteLength: normalBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes + normalBytes, byteLength: indexBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: wide ? 5125 : 5123, count: indexData.length, type: 'SCALAR' },
    ],
  }
  const jsonText = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = align4(jsonText.length)
  const total = 12 + 8 + jsonLength + 8 + binLength
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(jsonText, 20)
  out.fill(0x20, 20 + jsonText.length, 20 + jsonLength)
  let offset = 20 + jsonLength
  view.setUint32(offset, binLength, true)
  view.setUint32(offset + 4, 0x004e4942, true)
  offset += 8
  out.set(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, positionBytes), offset)
  out.set(new Uint8Array(mesh.normals.buffer, mesh.normals.byteOffset, normalBytes), offset + positionBytes)
  out.set(new Uint8Array(indexData.buffer, indexData.byteOffset, indexBytes), offset + positionBytes + normalBytes)
  return out
}
