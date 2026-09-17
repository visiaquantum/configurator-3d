import type { Object3D } from 'three'
import { Box3, Vector3 } from 'three'
import type { Vec3 } from '../types'

/**
 * Convention to declare snap points inside a product GLB:
 *
 * 1. Node `name` starts with `SNAP_` (or `snap:`), case-insensitive.
 *    The suffix is the point **kind**, lowercased, with any instance suffix
 *    stripped: `SNAP_TERRA-7` and `SNAP_TERRA-7_1` both yield kind `terra`.
 * 2. OR node `userData.kind === 'snap'` (glTF `extras.kind = "snap"`);
 *    `userData.id` (or the node name) supplies the kind.
 *
 * `kind` is the mating family (see scene/mating.ts): it decides what a point
 * may be joined to. `id` identifies the point *within one model* and is what
 * the project JSON stores. A kind that occurs once keeps the bare kind as its
 * id (`terra`); a kind that repeats is numbered in traversal order
 * (`frontale-1` … `frontale-10`), so every point stays addressable.
 *
 * The point is the world-space center of the node's geometry when it has
 * any (SolidWorks bakes marker geometry with identity pivots, so the node
 * origin is meaningless), else the node's world position. Marker meshes
 * are hidden by `hydrateItemSnapsAndHide`.
 *
 * `normal` is the outward direction of the face the point sits on, derived
 * from the model bounding box (the marker nodes carry no usable rotation).
 * The mating math uses it to face two joined products at each other.
 *
 * These are the product-side counterparts of enclosure anchors: a product
 * point can be snapped onto an enclosure anchor or onto another product's
 * point.
 */

// `SNAP_<KIND>[-<instance>][_<n>]`. The `-<instance>` suffix is SolidWorks'
// component number; the `_<n>` suffix is added by three's GLTFLoader when a
// GLB repeats a node name (KIT01 ships two uprights, so `SNAP_TERRA-7` occurs
// twice and the second becomes `SNAP_TERRA-7_1`). Both are stripped: they
// identify the instance, never the mating family.
const NAME_PREFIX_RE = /^snap[_:](.+?)(?:-\d+)?(?:_\d+)?$/i

/** Snap point in the model root's coordinate space (including the root's
 * own scale). scene/Item.tsx converts it into the item's local frame. */
export interface ExtractedSnapPoint {
  /** Unique within the model. Bare `kind`, or `kind-N` when kind repeats. */
  id: string
  /** Mating family, e.g. `terra`, `frontale`, `laterale`. */
  kind: string
  position: Vec3
  /** Outward normal of the bbox face the point lies on, if one is clear. */
  normal?: Vec3
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
}

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
    const m = obj.name.match(NAME_PREFIX_RE)
    if (m) {
      kind = m[1].toLowerCase()
    } else if (ud.kind === 'snap') {
      kind = ((ud.id as string | undefined) ?? obj.name).toLowerCase()
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

    raw.push({ kind, position, node: obj })
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

  // Model bbox for normal derivation: computed from the visible body, with the
  // marker nodes still shown. They are tiny relative to the body, so they do
  // not meaningfully inflate it.
  _modelBox.setFromObject(root)
  const hasBox = isFinite(_modelBox.min.x)

  return raw.map((r) => {
    let id = r.kind
    if ((perKind.get(r.kind) ?? 0) > 1) {
      const n = (seen.get(r.kind) ?? 0) + 1
      seen.set(r.kind, n)
      id = `${r.kind}-${n}`
    }
    const normal = hasBox ? faceNormalFor(r.position, _modelBox) : undefined
    return {
      extracted: { id, kind: r.kind, position: r.position, normal },
      node: r.node,
    }
  })
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
