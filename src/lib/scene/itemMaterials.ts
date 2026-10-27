import type { Material, Object3D } from 'three'
import { Color, DoubleSide, Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'

// Tuning for item reflections. Picks up the scene Environment HDR so items
// look glossy and reflect the warehouse lighting like the enclosure paint.
const ITEM_ENV_INTENSITY = 1.5
const ITEM_CLEARCOAT = 0.5
const ITEM_CLEARCOAT_ROUGHNESS = 0.1

/**
 * Walk the cloned item scene and per-instance-clone each material so we can
 * boost reflections without leaking through the shared `useGLTF` cache.
 *
 * For MeshPhysicalMaterial we can also raise the clearcoat to add a glossy
 * top-coat. For plain MeshStandardMaterial we only boost envMapIntensity —
 * upgrading to Physical via `copy()` corrupts physical-specific uniforms
 * (transmission/thickness become undefined) and the mesh renders invisible.
 */
export function enhanceItemMaterials(root: Object3D) {
  const materials = new Map<Material, Material>()
  const cloneMaterial = (m: Material): Material => {
    if (m instanceof MeshPhysicalMaterial) {
      const next = m.clone()
      next.envMapIntensity = Math.max(next.envMapIntensity, ITEM_ENV_INTENSITY)
      next.clearcoat = Math.max(next.clearcoat, ITEM_CLEARCOAT)
      next.clearcoatRoughness = Math.min(next.clearcoatRoughness, ITEM_CLEARCOAT_ROUGHNESS)
      next.needsUpdate = true
      return next
    }
    if (m instanceof MeshStandardMaterial) {
      const next = m.clone()
      next.envMapIntensity = Math.max(next.envMapIntensity, ITEM_ENV_INTENSITY)
      next.needsUpdate = true
      return next
    }
    return m.clone()
  }
  const upgrade = (m: Material) => {
    let cloned = materials.get(m)
    if (!cloned) { cloned = cloneMaterial(m); materials.set(m, cloned) }
    return cloned
  }
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(upgrade)
    } else {
      obj.material = upgrade(obj.material)
    }
  })
}

/**
 * The mirror flip (a negative scale on the wrapper) inverts face winding;
 * render both sides so the geometry doesn't show inside-out. Only call it on
 * materials `enhanceItemMaterials` already cloned, so the change cannot leak
 * into the shared `useGLTF` cache.
 */
export function renderBothSides(root: Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (m instanceof MeshStandardMaterial) m.side = DoubleSide
    }
  })
}

export type ItemTint = 'attachment-target' | 'collision' | null

const TINTS = { 'attachment-target': { color: new Color('#22c9ed'), amount: 0.45 }, collision: { color: new Color(0xff0000), amount: 0.6 } }

/**
 * Lerp each material toward the tint colour instead of overwriting it, so
 * textures and branding stay readable. Originals are captured once per
 * material in `originals`.
 */
export function applyItemTint(root: Object3D, originals: Map<MeshStandardMaterial, Color>, tint: ItemTint) {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (!(m instanceof MeshStandardMaterial)) continue
      if (!originals.has(m)) { originals.set(m, m.color.clone()); m.userData.originalColor = m.color.getHex() }
      const original = originals.get(m)!
      if (tint) m.color.copy(original).lerp(TINTS[tint].color, TINTS[tint].amount)
      else m.color.copy(original)
    }
  })
}

/** Release the per-instance materials of a cloned item. */
export function disposeItemMaterials(root: Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) (material as Material).dispose()
  })
}
