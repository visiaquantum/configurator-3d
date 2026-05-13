import { Box3, Vector3, type Group } from 'three'

/**
 * Registry of all live placed-item Three.js groups, keyed by item id.
 * Used by drag handlers (in PhysicsItem) to query other items' world geometry
 * for vertex-snapping and overlap push-out.
 *
 * Lives at module scope so it survives PhysicsItem remounts (which happen
 * on selection / snap-state changes via the Scene `key`).
 */

export interface ItemRegistration {
  id: string
  group: Group
  /** 8 local-space corners of the item's collider AABB (centered on the body). */
  localCorners: Vector3[]
}

const registry = new Map<string, ItemRegistration>()

export function registerItem(reg: ItemRegistration): void {
  registry.set(reg.id, reg)
}

export function unregisterItem(id: string): void {
  registry.delete(id)
}

export function getItem(id: string): ItemRegistration | undefined {
  return registry.get(id)
}

export function listOtherItems(excludeId: string): ItemRegistration[] {
  const out: ItemRegistration[] = []
  for (const [id, reg] of registry) {
    if (id !== excludeId) out.push(reg)
  }
  return out
}

/** Build the 8 local-space AABB corners for a centered box of the given size. */
export function buildLocalCorners(size: [number, number, number]): Vector3[] {
  const [sx, sy, sz] = size
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  return [
    new Vector3(-hx, -hy, -hz),
    new Vector3(hx, -hy, -hz),
    new Vector3(-hx, hy, -hz),
    new Vector3(hx, hy, -hz),
    new Vector3(-hx, -hy, hz),
    new Vector3(hx, -hy, hz),
    new Vector3(-hx, hy, hz),
    new Vector3(hx, hy, hz),
  ]
}

const _tmpV = new Vector3()

/** Fill `out` (length 8) with the registration's corners in world space. */
export function getWorldCorners(reg: ItemRegistration, out: Vector3[]): Vector3[] {
  reg.group.updateWorldMatrix(true, false)
  for (let i = 0; i < reg.localCorners.length; i++) {
    out[i].copy(reg.localCorners[i]).applyMatrix4(reg.group.matrixWorld)
  }
  return out
}

/** Fill `out` with the registration's world-space AABB (encloses rotated corners). */
export function getWorldAABB(reg: ItemRegistration, out: Box3): Box3 {
  out.makeEmpty()
  reg.group.updateWorldMatrix(true, false)
  for (const lc of reg.localCorners) {
    _tmpV.copy(lc).applyMatrix4(reg.group.matrixWorld)
    out.expandByPoint(_tmpV)
  }
  return out
}
