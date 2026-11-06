import type { Object3D } from 'three'
import { Box3, Matrix3, Vector3 } from 'three'
import { visibleBodyBounds } from '../scene/geometry'
import type { Vec3 } from '../types'

/**
 * Convention to declare snap points inside a product GLB:
 *
 * 1. Stable name `SNAP_<TIPO>__<NOME>` (production contract): `<TIPO>` is the
 *    mating family, `<NOME>` the point id, unique in the file and unchanged
 *    across re-exports. Both are lower-cased: `SNAP_FRONTALE__FORO_12` is
 *    point `foro_12` of kind `frontale`. Letters, digits and `_` only.
 * 2. Legacy name `SNAP_<TIPO>` with an optional CAD instance suffix
 *    (`SNAP_TERRA-7`): the kind only. A kind that occurs once keeps the bare
 *    kind as its id (`terra`); a kind that repeats is numbered in traversal
 *    order (`frontale-1` … `frontale-10`). A re-export that reorders the nodes
 *    renumbers them: these files are reported by the catalogue check.
 * 3. OR node `userData.kind === 'snap'` (glTF `extras.kind = "snap"`);
 *    `userData.snapKind` (or `userData.id`, or the node name) supplies the
 *    kind, `userData.id` the stable id.
 *
 * Names are read as written in the GLB (`userData.name`, kept by
 * GLTFLoader), before the loader appends `_1` to repeated names: a duplicated
 * stable name is reported, never silently renamed.
 *
 * The point is the world-space center of the node's geometry when it has
 * any (SolidWorks bakes marker geometry with identity pivots, so the node
 * origin is meaningless), else the node's world position. Marker meshes
 * are hidden by `hydrateItemSnapsAndHide`.
 *
 * `normal` is the outward direction of the face the point sits on, derived
 * from the model bounding box (the marker nodes carry no usable rotation).
 * The mating math uses it to face two joined products at each other.
 */

// `SNAP_<KIND>[-<instance>][_<n>]`. The `-<instance>` suffix is SolidWorks'
// component number; the `_<n>` suffix is added by three's GLTFLoader when a
// GLB repeats a node name (KIT01 ships two uprights, so `SNAP_TERRA-7` occurs
// twice and the second becomes `SNAP_TERRA-7_1`). Both are stripped: they
// identify the instance, never the mating family.
const NAME_PREFIX_RE = /^snap[_:](.+?)(?:-\d+)?(?:_\d+)?$/i
/** `SNAP_<TIPO>__<NOME>`: the stable form. Matched on the name as written in the GLB. */
const STABLE_NAME_RE = /^snap_([a-z0-9]+)__([a-z0-9_]+)$/i
/** Anything that starts like a marker; used to report malformed names. */
const MARKER_LIKE_RE = /^snap[_:]/i

/** Snap point in the model root's coordinate space (including the root's
 * own scale). scene/productAsset.ts converts it into the item's local frame. */
export interface ExtractedSnapPoint {
  /** Unique within the model. Stable `<nome>`, bare `kind`, or `kind-N` when a legacy kind repeats. */
  id: string
  /** Mating family, e.g. `terra`, `frontale`, `laterale`. */
  kind: string
  position: Vec3
  /** Outward normal of the bbox face the point lies on, if one is clear. */
  normal?: Vec3
  /** The marker's name as written in the GLB. */
  name?: string
  /** True when the id comes from the file (stable name or extras id), not from traversal order. */
  stable?: boolean
}

/** What a GLB's snap markers look like to the catalogue check. */
export interface SnapMarkerReport {
  points: ExtractedSnapPoint[]
  /** Stable ids carried by more than one marker. */
  duplicates: Array<{ id: string; names: string[] }>
  /** Markers numbered by traversal order (`SNAP_<TIPO>` or `SNAP_<TIPO>-N`). */
  legacy: string[]
  /** Names that look like markers but follow neither form (spaces, dots, `SNAP_X__`). */
  malformed: string[]
}

interface ExtractedSnapNode {
  extracted: ExtractedSnapPoint
  node: Object3D
}

const _box = new Box3()
const _center = new Vector3()
const _modelBox = new Box3()

interface RawSnapNode {
  kind: string
  position: Vec3
  node: Object3D
  name: string
  explicitId?: string
  normal?: Vec3
}

/** The name as authored: GLTFLoader keeps it in `userData.name` before making it unique. */
const authoredName = (obj: Object3D) => typeof obj.userData?.name === 'string' && obj.userData.name ? obj.userData.name as string : obj.name

/**
 * Outward normal of the model bbox face nearest to `p`, or undefined when the
 * point sits well inside the body (no face is a clear owner).
 *
 * Tolerance scales with the model so it works for a 3 cm panel and a 1.5 m
 * upright alike: a point within 5% of the smallest dimension of a face is
 * treated as lying on it.
 */
function faceNormalFor(p: Vec3, box: Box3): Vec3 | undefined {
  const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
  const min = [box.min.x, box.min.y, box.min.z]
  const max = [box.max.x, box.max.y, box.max.z]
  const tol = Math.max(Math.min(size[0], size[1], size[2]) * 0.05, 1e-4)

  const onFace: Array<{ axis: number; sign: number }> = []
  for (let a = 0; a < 3; a++) {
    if (Math.abs(p[a] - min[a]) <= tol) onFace.push({ axis: a, sign: -1 })
    if (Math.abs(max[a] - p[a]) <= tol) onFace.push({ axis: a, sign: 1 })
  }
  // A marker parked on an edge or corner touches several faces at once and no
  // single outward direction is right — report nothing rather than a guess.
  if (onFace.length !== 1) return undefined
  const n: Vec3 = [0, 0, 0]
  n[onFace[0].axis] = onFace[0].sign
  return n
}

export function extractItemSnapsFromObject(root: Object3D): ExtractedSnapNode[] {
  const raw: RawSnapNode[] = []

  root.traverse((obj) => {
    const ud = (obj.userData ?? {}) as Record<string, unknown>
    let kind: string | null = null
    let stableId: string | undefined
    const name = authoredName(obj)
    const stable = name.match(STABLE_NAME_RE)
    const m = stable ? null : obj.name.match(NAME_PREFIX_RE)
    if (stable) {
      kind = stable[1].toLowerCase()
      stableId = stable[2].toLowerCase()
    } else if (m) {
      kind = m[1].toLowerCase()
    } else if (ud.kind === 'snap') {
      kind = (typeof ud.snapKind === 'string' ? ud.snapKind : typeof ud.id === 'string' ? ud.id : obj.name).toLowerCase()
    }
    if (!kind) return

    obj.updateWorldMatrix(true, false)
    _box.setFromObject(obj)
    let position: Vec3
    if (isFinite(_box.min.x)) {
      _box.getCenter(_center)
      position = [_center.x, _center.y, _center.z]
    } else {
      obj.getWorldPosition(_center)
      position = [_center.x, _center.y, _center.z]
    }

    let normal: Vec3 | undefined
    if (Array.isArray(ud.normal) && ud.normal.length === 3 && ud.normal.every((value) => typeof value === 'number' && Number.isFinite(value)) && Math.hypot(...ud.normal) > 1e-9) {
      const direction = new Vector3(...ud.normal as Vec3).applyNormalMatrix(new Matrix3().getNormalMatrix(obj.matrixWorld))
      normal = direction.toArray() as Vec3
    }
    const explicitId = stableId ?? (ud.kind === 'snap' && typeof ud.id === 'string' && ud.id ? ud.id : undefined)
    raw.push({ kind, position, node: obj, name, normal, explicitId })
  })

  if (raw.length === 0) return []

  // A kind carried by a single node keeps the bare kind as its id; repeated
  // kinds are numbered in traversal order so each point is addressable.
  // KIT01 for instance ships eleven `frontale` markers, which would otherwise
  // collapse into one unusable id. Numbering by traversal rather than by the
  // node's own suffix keeps ids unique even when the GLB reuses a suffix
  // across duplicated sub-assemblies (`SNAP_FRONTALE-1` and its `_1` twin).
  const perKind = new Map<string, number>()
  for (const r of raw) perKind.set(r.kind, (perKind.get(r.kind) ?? 0) + 1)
  const seen = new Map<string, number>()

  // Marker geometry must not influence the body faces used to infer normals.
  _modelBox.copy(visibleBodyBounds(root))
  const hasBox = isFinite(_modelBox.min.x)

  return raw.map((r) => {
    let id = r.explicitId ?? r.kind
    if (!r.explicitId && (perKind.get(r.kind) ?? 0) > 1) {
      const n = (seen.get(r.kind) ?? 0) + 1
      seen.set(r.kind, n)
      id = `${r.kind}-${n}`
    }
    const normal = r.normal ?? (hasBox ? faceNormalFor(r.position, _modelBox) : undefined)
    return {
      extracted: { id, kind: r.kind, position: r.position, normal, name: r.name, stable: !!r.explicitId },
      node: r.node,
    }
  })
}

/**
 * The markers of a model with what the catalogue check needs to report:
 * duplicated stable ids (counted on the names as written in the GLB, before
 * the loader makes them unique), legacy numbered markers and malformed names.
 */
export function inspectSnapMarkers(root: Object3D): SnapMarkerReport {
  const found = extractItemSnapsFromObject(root)
  const byId = new Map<string, string[]>()
  for (const { extracted } of found) {
    if (!extracted.stable) continue
    byId.set(extracted.id, [...(byId.get(extracted.id) ?? []), extracted.name ?? extracted.id])
  }
  const malformed: string[] = []
  root.traverse((obj) => {
    const name = authoredName(obj)
    if (MARKER_LIKE_RE.test(name) && !STABLE_NAME_RE.test(name) && (name.includes('__') || /[^a-z0-9_:-]/i.test(name))) malformed.push(name)
  })
  return {
    points: found.map((entry) => entry.extracted),
    duplicates: [...byId].filter(([, names]) => names.length > 1).map(([id, names]) => ({ id, names })),
    legacy: found.filter((entry) => !entry.extracted.stable && MARKER_LIKE_RE.test(entry.extracted.name ?? '')).map((entry) => entry.extracted.name!),
    malformed,
  }
}

/**
 * Hide snap marker nodes from the rendered scene. Returns the extracted
 * points. Idempotent — call once per loaded model clone.
 */
export function hydrateItemSnapsAndHide(root: Object3D): ExtractedSnapPoint[] {
  const found = extractItemSnapsFromObject(root)
  for (const f of found) {
    f.node.visible = false
  }
  return found.map((f) => f.extracted)
}
