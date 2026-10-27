import { Box3, BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three'
import type { Camera, Object3D } from 'three'

const fullGeometries = new WeakMap<BufferGeometry, BufferGeometry>()

/** View-only cuts must never remove the enclosure from a geometry export. */
export function enclosureGeometryForExport(geometry: BufferGeometry): BufferGeometry {
  return fullGeometries.get(geometry) ?? geometry
}

/**
 * Hide nearby exterior wall triangles, including walls in a single merged mesh.
 *
 * Each cut is a geometry that shares the original vertex attributes and only
 * owns its index buffer, built the first time that view is needed. Switching
 * views swaps geometries: nothing is copied or uploaded to the GPU again.
 */
export function createEnclosureCutaway(root: Object3D, bounds: Box3) {
  root.updateWorldMatrix(true, true)
  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const direction = new Vector3()
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  const edge = new Vector3(), edge2 = new Vector3(), normal = new Vector3(), centroid = new Vector3()
  const entries: {
    mesh: Mesh
    original: BufferGeometry
    /** Three vertex indices per triangle. */
    corners: Uint32Array
    /** Wall bit per triangle (0 = never hidden). */
    walls: Uint8Array
    /** Material group per triangle. */
    materials: Uint16Array
    views: Map<number, BufferGeometry>
  }[] = []

  root.traverseVisible((object) => {
    if (!(object instanceof Mesh) || object.userData.configuratorHelper) return
    const original: BufferGeometry = object.geometry
    const position = original.getAttribute('position')
    if (!position) return
    const index = original.index
    const count = index?.count ?? position.count
    const start = original.drawRange.start
    const end = Math.min(count, start + original.drawRange.count)
    const triangleCount = Math.max(0, Math.floor((end - start) / 3))
    const corners = new Uint32Array(triangleCount * 3)
    const walls = new Uint8Array(triangleCount)
    const materials = new Uint16Array(triangleCount)
    for (const group of original.groups) {
      const first = Math.max(0, Math.ceil((group.start - start) / 3))
      const last = Math.min(triangleCount, Math.floor((group.start + group.count - start) / 3))
      materials.fill(group.materialIndex ?? 0, first, Math.max(first, last))
    }
    let anyWall = false
    for (let t = 0; t < triangleCount; t++) {
      const i = start + t * 3
      for (let k = 0; k < 3; k++) corners[t * 3 + k] = index ? index.getX(i + k) : i + k
      a.fromBufferAttribute(position, corners[t * 3]).applyMatrix4(object.matrixWorld)
      b.fromBufferAttribute(position, corners[t * 3 + 1]).applyMatrix4(object.matrixWorld)
      c.fromBufferAttribute(position, corners[t * 3 + 2]).applyMatrix4(object.matrixWorld)
      normal.crossVectors(edge.subVectors(b, a), edge2.subVectors(c, a)).normalize()
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center)
      // Keep horizontal surfaces and partitions in the middle of the cargo area.
      // Winding is irrelevant: both skins of a thick wall disappear together.
      if (Math.abs(normal.x) > Math.abs(normal.y) * 1.5 && Math.abs(normal.x) >= Math.abs(normal.z) && Math.abs(centroid.x) > size.x * 0.3) {
        walls[t] = centroid.x > 0 ? 1 : 2
      } else if (Math.abs(normal.z) > Math.abs(normal.y) * 1.5 && Math.abs(normal.z) > Math.abs(normal.x) && Math.abs(centroid.z) > size.z * 0.3) {
        walls[t] = centroid.z > 0 ? 4 : 8
      }
      anyWall ||= walls[t] !== 0
    }
    if (!anyWall) return
    if (!original.boundingBox) original.computeBoundingBox()
    if (!original.boundingSphere) original.computeBoundingSphere()
    entries.push({ mesh: object, original, corners, walls, materials, views: new Map() })
  })

  const viewFor = (entry: typeof entries[number], mask: number): BufferGeometry => {
    const cached = entry.views.get(mask)
    if (cached) return cached
    const kept = new Uint32Array(entry.corners.length)
    let used = 0
    const view = new BufferGeometry()
    for (const [name, attribute] of Object.entries(entry.original.attributes)) view.setAttribute(name, attribute)
    view.morphAttributes = entry.original.morphAttributes
    view.morphTargetsRelative = entry.original.morphTargetsRelative
    view.boundingBox = entry.original.boundingBox
    view.boundingSphere = entry.original.boundingSphere
    for (let t = 0; t < entry.walls.length; t++) {
      if (entry.walls[t] & mask) continue
      const material = entry.materials[t]
      const group = view.groups[view.groups.length - 1]
      if (group && group.materialIndex === material) group.count += 3
      else view.addGroup(used, 3, material)
      kept.set(entry.corners.subarray(t * 3, t * 3 + 3), used)
      used += 3
    }
    view.setIndex(new BufferAttribute(kept.slice(0, used), 1))
    fullGeometries.set(view, entry.original)
    entry.views.set(mask, view)
    return view
  }

  let previousMask = -1
  return {
    update(camera: Camera, enabled: boolean) {
      let mask = 0
      if (enabled) {
        camera.getWorldDirection(direction)
        if (Math.abs(direction.x) > 0.15) mask |= direction.x < 0 ? 1 : 2
        if (Math.abs(direction.z) > 0.15) mask |= direction.z < 0 ? 4 : 8
      }
      if (mask === previousMask) return
      previousMask = mask
      for (const entry of entries) entry.mesh.geometry = mask === 0 ? entry.original : viewFor(entry, mask)
    },
    dispose() {
      for (const entry of entries) {
        entry.mesh.geometry = entry.original
        for (const view of entry.views.values()) {
          fullGeometries.delete(view)
          // Release only the view's own index buffer: the vertex attributes
          // still belong to the original geometry.
          for (const name of Object.keys(view.attributes)) view.deleteAttribute(name)
          view.morphAttributes = {}
          view.dispose()
        }
      }
    },
  }
}
