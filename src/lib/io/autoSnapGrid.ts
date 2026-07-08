import type { Object3D } from 'three'
import { Box3, Mesh, Vector3 } from 'three'
import type { ItemRule, Vec3 } from '../types'
import type { ExtractedSnapPoint } from './itemSnaps'

export const AUTO_SNAP_GRID_RULE = 'auto-snap-grid'

type AxisIndex = 0 | 1 | 2
type PlaneSide = 'min' | 'max'

type Pair = {
  a: number
  b: number
  center: number
}

type PlaneCandidate = {
  axis: AxisIndex
  uAxis: AxisIndex
  vAxis: AxisIndex
  coord: number
  label: string
  planeTolerance: number
}

const AXES: AxisIndex[] = [0, 1, 2]
const AXIS_NAMES = ['x', 'y', 'z'] as const
const DEFAULT_MIN_HOLE_SIZE = 0.006
const DEFAULT_MAX_HOLE_SIZE = 0.018
const DEFAULT_PLANE_TOLERANCE = 0.001
const DEFAULT_VERTEX_TOLERANCE = 0.00001
const MIN_GRID_POINTS = 4

function numParam(params: Record<string, unknown>, key: string, fallback: number) {
  const v = params[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function vecParam(params: Record<string, unknown>, key: string): Vec3 | null {
  const v = params[key]
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
    ? (v as Vec3)
    : null
}

function dominantAxis(v: Vec3): AxisIndex {
  const ax = Math.abs(v[0])
  const ay = Math.abs(v[1])
  const az = Math.abs(v[2])
  if (ax >= ay && ax >= az) return 0
  return ay >= az ? 1 : 2
}

function quantize(v: number, tolerance: number) {
  return Math.round(v / tolerance) * tolerance
}

function key(u: number, v: number, tolerance: number) {
  return `${quantize(u, tolerance).toFixed(6)},${quantize(v, tolerance).toFixed(6)}`
}

function pointKey(p: Vec3, tolerance: number) {
  return p.map((n) => quantize(n, tolerance).toFixed(6)).join(',')
}

function closePairs(values: number[], minSize: number, maxSize: number): Pair[] {
  const out: Pair[] = []
  for (let i = 0; i < values.length - 1; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const d = values[j] - values[i]
      if (d > maxSize) break
      if (d >= minSize) out.push({ a: values[i], b: values[j], center: (values[i] + values[j]) / 2 })
    }
  }
  return out
}

function pushVertex(out: Vec3[], obj: Object3D, vertex: Vector3) {
  vertex.applyMatrix4(obj.matrixWorld)
  out.push([vertex.x, vertex.y, vertex.z])
}

function collectMeshVertices(root: Object3D): Vec3[] {
  const out: Vec3[] = []
  const v = new Vector3()

  root.updateWorldMatrix(true, true)
  root.traverse((obj) => {
    if (!obj.visible || !(obj instanceof Mesh)) return
    const pos = obj.geometry.getAttribute('position')
    if (!pos) return
    obj.updateWorldMatrix(true, false)
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i)
      pushVertex(out, obj, v)
    }
  })

  return out
}

function makePlane(
  axis: AxisIndex,
  side: PlaneSide,
  coord: number,
  planeTolerance: number,
): PlaneCandidate {
  const projectedAxes = AXES.filter((a) => a !== axis) as [AxisIndex, AxisIndex]
  return {
    axis,
    uAxis: projectedAxes[0],
    vAxis: projectedAxes[1],
    coord,
    label: `${AXIS_NAMES[axis]}${side}`,
    planeTolerance,
  }
}

function choosePrimaryPlane(vertices: Vec3[], min: Vec3, max: Vec3, size: Vec3, planeTolerance: number) {
  const axis: AxisIndex = size[0] <= size[1] && size[0] <= size[2] ? 0 : size[1] <= size[2] ? 1 : 2
  const minCount = vertices.filter((p) => Math.abs(p[axis] - min[axis]) <= planeTolerance).length
  const maxCount = vertices.filter((p) => Math.abs(p[axis] - max[axis]) <= planeTolerance).length
  const side: PlaneSide = maxCount >= minCount ? 'max' : 'min'
  return makePlane(axis, side, side === 'max' ? max[axis] : min[axis], planeTolerance)
}

function choosePlanes(vertices: Vec3[], params: Record<string, unknown>): PlaneCandidate[] {
  const bbox = new Box3()
  for (const p of vertices) bbox.expandByPoint(new Vector3(...p))

  const min: Vec3 = [bbox.min.x, bbox.min.y, bbox.min.z]
  const max: Vec3 = [bbox.max.x, bbox.max.y, bbox.max.z]
  const size: Vec3 = [bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z]
  const normal = vecParam(params, 'normal')
  const planeTolerance = numParam(params, 'planeTolerance', DEFAULT_PLANE_TOLERANCE)

  if (normal) {
    const axis = dominantAxis(normal)
    const side: PlaneSide = normal[axis] >= 0 ? 'max' : 'min'
    return [makePlane(axis, side, side === 'max' ? max[axis] : min[axis], planeTolerance)]
  }

  // Default: scan all external faces. `faces: "primary"` keeps the original
  // behaviour (only the densest face on the model's thinnest axis).
  if (params.faces === 'primary') return [choosePrimaryPlane(vertices, min, max, size, planeTolerance)]

  return AXES.flatMap((axis) => [
    makePlane(axis, 'min', min[axis], planeTolerance),
    makePlane(axis, 'max', max[axis], planeTolerance),
  ])
}

function sortedUnique(values: number[], tolerance: number) {
  return [...new Set(values.map((v) => quantize(v, tolerance)))].sort((a, b) => a - b)
}

function groupValues(values: number[], tolerance: number) {
  return sortedUnique(values, tolerance)
}

function makePoint(uAxis: AxisIndex, vAxis: AxisIndex, planeAxis: AxisIndex, u: number, v: number, plane: number): Vec3 {
  const p: Vec3 = [0, 0, 0]
  p[uAxis] = u
  p[vAxis] = v
  p[planeAxis] = plane
  return p
}

function detectGridOnPlane(
  vertices: Vec3[],
  plane: PlaneCandidate,
  minHoleSize: number,
  maxHoleSize: number,
  vertexTolerance: number,
): ExtractedSnapPoint[] {
  const face = vertices.filter((p) => Math.abs(p[plane.axis] - plane.coord) <= plane.planeTolerance)
  if (face.length === 0) return []

  const pointSet = new Set(face.map((p) => key(p[plane.uAxis], p[plane.vAxis], vertexTolerance)))
  const uValues = sortedUnique(face.map((p) => p[plane.uAxis]), vertexTolerance)
  const vValues = sortedUnique(face.map((p) => p[plane.vAxis]), vertexTolerance)
  const uPairs = closePairs(uValues, minHoleSize, maxHoleSize)
  const vPairs = closePairs(vValues, minHoleSize, maxHoleSize)
  const centers = new Map<string, Vec3>()

  for (const up of uPairs) {
    for (const vp of vPairs) {
      const hasCorners =
        pointSet.has(key(up.a, vp.a, vertexTolerance)) &&
        pointSet.has(key(up.b, vp.a, vertexTolerance)) &&
        pointSet.has(key(up.a, vp.b, vertexTolerance)) &&
        pointSet.has(key(up.b, vp.b, vertexTolerance))
      if (!hasCorners) continue
      const p = makePoint(plane.uAxis, plane.vAxis, plane.axis, up.center, vp.center, plane.coord)
      centers.set(pointKey(p, vertexTolerance), p)
    }
  }

  if (centers.size < MIN_GRID_POINTS) return []

  const points = [...centers.values()].sort(
    (a, b) => a[plane.vAxis] - b[plane.vAxis] || a[plane.uAxis] - b[plane.uAxis],
  )
  const rows = groupValues(points.map((p) => p[plane.vAxis]), vertexTolerance)
  const cols = groupValues(points.map((p) => p[plane.uAxis]), vertexTolerance)

  return points.map((position) => {
    const row = rows.findIndex((v) => Math.abs(v - quantize(position[plane.vAxis], vertexTolerance)) <= vertexTolerance)
    const col = cols.findIndex((v) => Math.abs(v - quantize(position[plane.uAxis], vertexTolerance)) <= vertexTolerance)
    return {
      id: `auto-grid-${plane.label}-r${row}-c${col}`,
      position,
    }
  })
}

/**
 * Generate product snap points from regular rectangular perforations.
 *
 * The GLB only has to declare a rule `{ kind:'rule', rule:'auto-snap-grid' }`.
 * By default all six external faces are scanned, so side/top/bottom holes are
 * included too. Optional params can tune detection: `normal`, `faces`,
 * `minHoleSize`, `maxHoleSize`, `planeTolerance`, `vertexTolerance`.
 */
export function extractAutoSnapGridFromObject(root: Object3D, rules: ItemRule[]): ExtractedSnapPoint[] {
  const rule = rules.find((r) => r.rule === AUTO_SNAP_GRID_RULE)
  if (!rule) return []

  const params = rule.params ?? {}
  const vertices = collectMeshVertices(root)
  if (vertices.length === 0) return []

  const minHoleSize = numParam(params, 'minHoleSize', DEFAULT_MIN_HOLE_SIZE)
  const maxHoleSize = numParam(params, 'maxHoleSize', DEFAULT_MAX_HOLE_SIZE)
  const vertexTolerance = numParam(params, 'vertexTolerance', DEFAULT_VERTEX_TOLERANCE)
  const all = new Map<string, ExtractedSnapPoint>()

  for (const plane of choosePlanes(vertices, params)) {
    for (const sp of detectGridOnPlane(vertices, plane, minHoleSize, maxHoleSize, vertexTolerance)) {
      all.set(`${sp.id}:${pointKey(sp.position, vertexTolerance)}`, sp)
    }
  }

  return [...all.values()]
}
