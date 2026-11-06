import type { Object3D } from 'three'
import { Box3, Quaternion, Vector3 } from 'three'
import type { Anchor, Vec3 } from '../types'

/**
 * Convention to mark anchor nodes inside an enclosure GLB:
 *
 * 1. Node `name` starts with `anchor_` (or `anchor:`). Suffix = anchor id.
 *    e.g. `anchor_shelf1`, `anchor:back-left`.
 * 2. OR node `userData.kind === 'anchor'` (via glTF `extras.kind = "anchor"`).
 *    In this case `userData.id` (or node.name) provides the id.
 * 3. Optional `userData.normal: [x, y, z]` (via glTF `extras.normal`)
 *    overrides the computed +Y world axis of the node.
 *
 * A marker with geometry (the ~1 cm cube SolidWorks exports, pivot at the
 * model origin) stands for the centre of that geometry, which is the anchor
 * position; an Empty stands for its own world position. The world +Y
 * direction is the default normal.
 */

const NAME_PREFIX_RE = /^anchor[_:](.+)$/i
const round = (value: number) => Math.round(value * 1e6) / 1e6

interface ExtractedAnchorNode {
  anchor: Anchor
  node: Object3D
}

export function extractAnchorsFromObject(root: Object3D): ExtractedAnchorNode[] {
  const out: ExtractedAnchorNode[] = []
  const worldPos = new Vector3()
  const worldUp = new Vector3()
  const localUp = new Vector3(0, 1, 0)
  const worldQuat = new Quaternion()
  const box = new Box3()

  root.traverse((obj) => {
    const ud = (obj.userData ?? {}) as Record<string, unknown>
    const kind = ud.kind
    const isAnchorByExtras = kind === 'anchor'

    let id: string | null = null
    const m = obj.name.match(NAME_PREFIX_RE)
    if (m) id = m[1]
    else if (isAnchorByExtras) id = typeof ud.id === 'string' ? ud.id : obj.name

    if (!id) return

    obj.updateWorldMatrix(true, true)
    // The pivot of an exported cube is meaningless: its geometry is the marker.
    box.setFromObject(obj)
    if (box.isEmpty()) obj.getWorldPosition(worldPos)
    else box.getCenter(worldPos)
    const position: Vec3 = [round(worldPos.x), round(worldPos.y), round(worldPos.z)]

    let normal: Vec3 | undefined
    const overrideNormal = ud.normal as unknown
    if (
      Array.isArray(overrideNormal) &&
      overrideNormal.length === 3 &&
      overrideNormal.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      normal = overrideNormal as Vec3
    } else {
      obj.getWorldQuaternion(worldQuat)
      worldUp.copy(localUp).applyQuaternion(worldQuat).normalize()
      normal = [+worldUp.x.toFixed(6), +worldUp.y.toFixed(6), +worldUp.z.toFixed(6)]
    }

    out.push({ anchor: { id, position, normal }, node: obj })
  })

  return out
}

export function extractAnchorsFromGLB(root: Object3D): Anchor[] {
  return extractAnchorsFromObject(root).map((x) => x.anchor)
}

/**
 * Hide anchor marker nodes from the rendered scene. Returns the anchor list.
 * Idempotent — call once per scene load.
 */
export function hydrateAnchorsAndHide(root: Object3D): Anchor[] {
  const found = extractAnchorsFromObject(root)
  for (const f of found) {
    f.node.visible = false
  }
  return found.map((x) => x.anchor)
}
