import type { Object3D } from 'three'
import { Box3, Mesh, Vector3 } from 'three'
import type { ItemRule, Vec3 } from '../types'
import type { ExtractedSnapPoint } from './itemSnaps'

export const AUTO_SNAP_GRID_RULE = 'auto-snap-grid'

/** Mating family assigned to every generated hole centre. */
export const AUTO_GRID_SNAP_KIND = 'foro'

/**
 * Generate product snap points from the perforations of a plate.
 *
 * Detection works on **boundary loops**, not on vertex patterns. For each
 * external face we take the triangles lying in that plane, count how many
 * triangles use each edge, and keep the edges used exactly once — those are
 * the face's outlines. Chaining them yields closed loops: the big one is the
 * plate's own silhouette, the small ones are the holes. The centre of each
 * small loop becomes a snap point.
 *
 * The earlier heuristic looked for four coplanar vertices forming a rectangle.
 * That fires on any regular tessellation, so a 52k-triangle extruded profile
 * produced ~1800 phantom "holes" on a single face, and its cost was quadratic
 * in the number of distinct coordinates — one 8.8k-triangle accessory never
 * finished. Loop finding is linear in the triangle count and only reports
 * geometry that really is a hole.
 */

type AxisIndex = 0 | 1 | 2
type PlaneSide = 'min' | 'max'

type PlaneCandidate = {
  axis: AxisIndex
  uAxis: AxisIndex
  vAxis: AxisIndex
  coord: number
  side: PlaneSide
  label: string
  planeTolerance: number
}

const AXES: AxisIndex[] = [0, 1, 2]
const AXIS_NAMES = ['x', 'y', 'z'] as const
/** Hole bbox must fall inside this window, on both in-plane axes (metres). */
const DEFAULT_MIN_HOLE_SIZE = 0.003
const DEFAULT_MAX_HOLE_SIZE = 0.030
const DEFAULT_PLANE_TOLERANCE = 0.001
/** Welding tolerance for vertices shared between triangles. */
const DEFAULT_VERTEX_TOLERANCE = 0.00001

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

function vecListParam(params: Record<string, unknown>, key: string): Vec3[] {
  const v = params[key]
  if (!Array.isArray(v)) return []
  return v.filter((entry): entry is Vec3 =>
    Array.isArray(entry) && entry.length === 3 && entry.every((n) => typeof n === 'number'),
  )
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

function pointKey(p: Vec3, tolerance: number) {
  return p.map((n) => quantize(n, tolerance).toFixed(6)).join(',')
}

// --- geometry collection ---------------------------------------------------

type Triangle = [Vec3, Vec3, Vec3]

/** World-space triangles of every visible mesh under `root`. */
function collectTriangles(root: Object3D): Triangle[] {
  const out: Triangle[] = []
  const v = new Vector3()

  root.updateWorldMatrix(true, true)
  root.traverse((obj) => {
    if (!obj.visible || !(obj instanceof Mesh)) return
    const pos = obj.geometry.getAttribute('position')
    if (!pos) return
    obj.updateWorldMatrix(true, false)

    const index = obj.geometry.index
    const count = index ? index.count : pos.count
    const at = (i: number): Vec3 => {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i)
      v.applyMatrix4(obj.matrixWorld)
      return [v.x, v.y, v.z]
    }
    for (let i = 0; i + 2 < count; i += 3) {
      out.push([at(i), at(i + 1), at(i + 2)])
    }
  })

  return out
}

/**
 * A whole product's bounding box is unsuitable for a bracket assembled onto
 * it: the bracket's lateral face is not necessarily also the product's outer
 * face. Select matching meshes and analyse each in its own local bbox.
 */
function collectTriangleGroups(root: Object3D, meshNameIncludes: string[]): Triangle[][] {
  if (meshNameIncludes.length === 0) return [collectTriangles(root)]
  const groups: Triangle[][] = []
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !meshNameIncludes.some((value) => obj.name.includes(value))) return
    const triangles = collectTriangles(obj)
    if (triangles.length > 0) groups.push(triangles)
  })
  return groups
}

function trianglesBBox(tris: Triangle[]): Box3 {
  const box = new Box3()
  const v = new Vector3()
  for (const t of tris) {
    for (const p of t) box.expandByPoint(v.set(p[0], p[1], p[2]))
  }
  return box
}

// --- plane selection -------------------------------------------------------

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
    side,
    label: `${AXIS_NAMES[axis]}${side}`,
    planeTolerance,
  }
}

/** Outward normal of a scanned face — the direction a mating part comes from. */
function planeNormal(plane: PlaneCandidate): Vec3 {
  const n: Vec3 = [0, 0, 0]
  n[plane.axis] = plane.side === 'max' ? 1 : -1
  return n
}

function choosePlanes(box: Box3, params: Record<string, unknown>): PlaneCandidate[] {
  const min: Vec3 = [box.min.x, box.min.y, box.min.z]
  const max: Vec3 = [box.max.x, box.max.y, box.max.z]
  const size: Vec3 = [
    box.max.x - box.min.x,
    box.max.y - box.min.y,
    box.max.z - box.min.z,
  ]
  const normal = vecParam(params, 'normal')
  const normals = vecListParam(params, 'normals')
  const planeTolerance = numParam(params, 'planeTolerance', DEFAULT_PLANE_TOLERANCE)

  // A product can have meaningful perforations on more than one face (for
  // example four holes on each XDS end cap). This list is deliberately
  // evaluated before the legacy single `normal` setting.
  if (normals.length > 0) {
    const seen = new Set<string>()
    return normals.flatMap((candidate) => {
      const axis = dominantAxis(candidate)
      const side: PlaneSide = candidate[axis] >= 0 ? 'max' : 'min'
      const key = `${axis}:${side}`
      if (seen.has(key)) return []
      seen.add(key)
      return [makePlane(axis, side, side === 'max' ? max[axis] : min[axis], planeTolerance)]
    })
  }

  if (normal) {
    const axis = dominantAxis(normal)
    const side: PlaneSide = normal[axis] >= 0 ? 'max' : 'min'
    return [makePlane(axis, side, side === 'max' ? max[axis] : min[axis], planeTolerance)]
  }

  // `faces: "primary"` scans only the two faces of the model's thinnest axis —
  // the flat sides of a plate. Default scans all six.
  if (params.faces === 'primary') {
    const axis: AxisIndex = size[0] <= size[1] && size[0] <= size[2] ? 0 : size[1] <= size[2] ? 1 : 2
    return [
      makePlane(axis, 'min', min[axis], planeTolerance),
      makePlane(axis, 'max', max[axis], planeTolerance),
    ]
  }

  return AXES.flatMap((axis) => [
    makePlane(axis, 'min', min[axis], planeTolerance),
    makePlane(axis, 'max', max[axis], planeTolerance),
  ])
}

// --- boundary loop detection ----------------------------------------------

interface Loop {
  /** In-plane bbox extent on the plane's u and v axes. */
  du: number
  dv: number
  centerU: number
  centerV: number
}

/**
 * Closed boundary loops of the triangles lying in `plane`.
 *
 * An edge shared by two triangles is interior; an edge used once bounds the
 * surface, either at the plate's silhouette or around a hole. Walking the
 * boundary edges through a vertex adjacency map recovers each loop.
 */
function boundaryLoops(
  tris: Triangle[],
  plane: PlaneCandidate,
  vertexTolerance: number,
): Loop[] {
  const onPlane = (p: Vec3) => Math.abs(p[plane.axis] - plane.coord) <= plane.planeTolerance

  // Edge use counts, keyed by the unordered pair of welded endpoints.
  const edgeCount = new Map<string, number>()
  const vertexPos = new Map<string, Vec3>()
  const edgeEnds = new Map<string, [string, string]>()

  const vkey = (p: Vec3) => pointKey(p, vertexTolerance)

  for (const t of tris) {
    if (!onPlane(t[0]) || !onPlane(t[1]) || !onPlane(t[2])) continue
    const k = [vkey(t[0]), vkey(t[1]), vkey(t[2])]
    vertexPos.set(k[0], t[0])
    vertexPos.set(k[1], t[1])
    vertexPos.set(k[2], t[2])
    for (let i = 0; i < 3; i++) {
      const a = k[i]
      const b = k[(i + 1) % 3]
      if (a === b) continue // degenerate after welding
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`
      edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1)
      edgeEnds.set(ek, a < b ? [a, b] : [b, a])
    }
  }

  // Adjacency over boundary edges only.
  const adj = new Map<string, string[]>()
  for (const [ek, count] of edgeCount) {
    if (count !== 1) continue
    const [a, b] = edgeEnds.get(ek)!
    ;(adj.get(a) ?? adj.set(a, []).get(a)!).push(b)
    ;(adj.get(b) ?? adj.set(b, []).get(b)!).push(a)
  }

  const loops: Loop[] = []
  const visited = new Set<string>()

  for (const start of adj.keys()) {
    if (visited.has(start)) continue

    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    let node: string | null = start
    let prev: string | null = null

    while (node && !visited.has(node)) {
      visited.add(node)
      const p = vertexPos.get(node)!
      const u = p[plane.uAxis]
      const v = p[plane.vAxis]
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v

      const next: string | undefined = (adj.get(node) ?? []).find(
        (n) => n !== prev && !visited.has(n),
      )
      prev = node
      node = next ?? null
    }

    if (minU === Infinity) continue
    loops.push({
      du: maxU - minU,
      dv: maxV - minV,
      centerU: (minU + maxU) / 2,
      centerV: (minV + maxV) / 2,
    })
  }

  return loops
}

function makePoint(
  uAxis: AxisIndex,
  vAxis: AxisIndex,
  planeAxis: AxisIndex,
  u: number,
  v: number,
  plane: number,
): Vec3 {
  const p: Vec3 = [0, 0, 0]
  p[uAxis] = u
  p[vAxis] = v
  p[planeAxis] = plane
  return p
}

/** Distinct values, merged when closer together than `tolerance`. */
function clusterValues(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > tolerance) out.push(v)
  }
  return out
}

function detectHolesOnPlane(
  tris: Triangle[],
  plane: PlaneCandidate,
  minHoleSize: number,
  maxHoleSize: number,
  vertexTolerance: number,
): ExtractedSnapPoint[] {
  const holes = boundaryLoops(tris, plane, vertexTolerance).filter(
    (l) =>
      l.du >= minHoleSize &&
      l.du <= maxHoleSize &&
      l.dv >= minHoleSize &&
      l.dv <= maxHoleSize,
  )
  if (holes.length === 0) return []

  // Row/column indices purely for readable ids ("Foro r3 c2"). Cluster at half
  // the max hole size so holes of one row land on the same index.
  const tol = maxHoleSize / 2
  const rows = clusterValues(holes.map((h) => h.centerV), tol)
  const cols = clusterValues(holes.map((h) => h.centerU), tol)
  const nearest = (arr: number[], v: number) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - v)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  const normal = planeNormal(plane)
  return holes.map((h) => ({
    id: `auto-grid-${plane.label}-r${nearest(rows, h.centerV)}-c${nearest(cols, h.centerU)}`,
    kind: AUTO_GRID_SNAP_KIND,
    position: makePoint(plane.uAxis, plane.vAxis, plane.axis, h.centerU, h.centerV, plane.coord),
    normal,
  }))
}

function withUniqueIds(points: ExtractedSnapPoint[]): ExtractedSnapPoint[] {
  const count = new Map<string, number>()
  return points.map((point) => {
    const occurrence = count.get(point.id) ?? 0
    count.set(point.id, occurrence + 1)
    return occurrence === 0 ? point : { ...point, id: `${point.id}-${occurrence + 1}` }
  })
}

/**
 * Generate product snap points from the perforations of a plate.
 *
 * The GLB only has to declare a rule `{ kind:'rule', rule:'auto-snap-grid' }`
 * (or a node named `RULE_AUTOSNAPGRID`). By default all six external faces are
 * scanned. Optional params tune detection: `normal`, `normals`, `faces`,
 * `meshNameIncludes`, `minHoleSize`, `maxHoleSize`, `planeTolerance`,
 * `vertexTolerance`.
 */
export function extractAutoSnapGridFromObject(
  root: Object3D,
  rules: ItemRule[],
): ExtractedSnapPoint[] {
  const rule = rules.find((r) => r.rule === AUTO_SNAP_GRID_RULE)
  if (!rule) return []

  const params = rule.params ?? {}
  const minHoleSize = numParam(params, 'minHoleSize', DEFAULT_MIN_HOLE_SIZE)
  const maxHoleSize = numParam(params, 'maxHoleSize', DEFAULT_MAX_HOLE_SIZE)
  const vertexTolerance = numParam(params, 'vertexTolerance', DEFAULT_VERTEX_TOLERANCE)
  const all = new Map<string, ExtractedSnapPoint>()

  const meshNameIncludes = Array.isArray(params.meshNameIncludes)
    ? params.meshNameIncludes.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  const groups = collectTriangleGroups(root, meshNameIncludes)
  if (groups.length === 0) return []
  for (const group of groups) {
    const box = trianglesBBox(group)
    for (const plane of choosePlanes(box, params)) {
      for (const sp of detectHolesOnPlane(group, plane, minHoleSize, maxHoleSize, vertexTolerance)) {
        all.set(pointKey(sp.position, vertexTolerance), sp)
      }
    }
  }

  return withUniqueIds([...all.values()])
}
