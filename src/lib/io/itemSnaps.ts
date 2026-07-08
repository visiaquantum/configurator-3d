import type { Object3D } from 'three'
import { Box3, Vector3 } from 'three'
import type { Vec3 } from '../types'

/**
 * Convention to declare snap points inside a product GLB:
 *
 * 1. Node `name` starts with `SNAP_` (or `snap:`), case-insensitive.
 *    Suffix = point id, lowercased; a trailing SolidWorks instance number
 *    (`-N`) is stripped. e.g. `SNAP_TERRA-7` → id `terra`.
 * 2. OR node `userData.kind === 'snap'` (glTF `extras.kind = "snap"`);
 *    `userData.id` (or the node name) supplies the id.
 *
 * The point is the world-space center of the node's geometry when it has
 * any (SolidWorks bakes marker geometry with identity pivots, so the node
 * origin is meaningless), else the node's world position. Marker meshes
 * are hidden by `hydrateItemSnapsAndHide`.
 *
 * These are the product-side counterparts of enclosure anchors: the drag
 * logic snaps a product snap point onto an enclosure anchor.
 */

const NAME_PREFIX_RE = /^snap[_:](.+?)(?:-\d+)?$/i

/** Snap point in the model root's coordinate space (including the root's
 * own scale). scene/Item.tsx converts it into the item's local frame. */
export interface ExtractedSnapPoint {
  id: string
  position: Vec3
}

interface ExtractedSnapNode {
  extracted: ExtractedSnapPoint
  node: Object3D
}

const _box = new Box3()
const _center = new Vector3()

export function extractItemSnapsFromObject(root: Object3D): ExtractedSnapNode[] {
  const out: ExtractedSnapNode[] = []

  root.traverse((obj) => {
    const ud = (obj.userData ?? {}) as Record<string, unknown>
    let id: string | null = null
    const m = obj.name.match(NAME_PREFIX_RE)
    if (m) id = m[1].toLowerCase()
    else if (ud.kind === 'snap') id = ((ud.id as string | undefined) ?? obj.name).toLowerCase()
    if (!id) return

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

    out.push({ extracted: { id, position }, node: obj })
  })

  return out
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
