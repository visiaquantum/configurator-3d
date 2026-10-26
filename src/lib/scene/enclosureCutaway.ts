import { Box3, BufferAttribute, Mesh, Vector3 } from 'three'
import type { BufferGeometry, Camera, Object3D } from 'three'

const fullGeometries = new WeakMap<BufferGeometry, BufferGeometry>()

/** View-only cuts must never remove the enclosure from a geometry export. */
export function enclosureGeometryForExport(geometry: BufferGeometry): BufferGeometry {
  return fullGeometries.get(geometry) ?? geometry
}

/** Hide nearby exterior wall triangles, including walls in a single merged mesh. */
export function createEnclosureCutaway(root: Object3D, bounds: Box3) {
  root.updateWorldMatrix(true, true)
  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const direction = new Vector3()
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  const edge = new Vector3(), normal = new Vector3(), centroid = new Vector3()
  const entries: {
    mesh: Mesh
    original: BufferGeometry
    geometry: BufferGeometry
    triangles: { indices: number[]; wall: number; material: number }[]
    views: Map<number, { index: BufferAttribute; groups: { start: number; count: number; materialIndex: number }[] }>
  }[] = []

  root.traverseVisible((object) => {
    if (!(object instanceof Mesh) || object.userData.configuratorHelper) return
    const original: BufferGeometry = object.geometry
    const position = original.getAttribute('position')
    if (!position) return
    const index = original.index
    const count = index?.count ?? position.count
    const triangles: typeof entries[number]['triangles'] = []
    const start = original.drawRange.start
    const end = Math.min(count, start + original.drawRange.count)
    for (let i = start; i + 2 < end; i += 3) {
      const indices = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset)
      a.fromBufferAttribute(position, indices[0]).applyMatrix4(object.matrixWorld)
      b.fromBufferAttribute(position, indices[1]).applyMatrix4(object.matrixWorld)
      c.fromBufferAttribute(position, indices[2]).applyMatrix4(object.matrixWorld)
      normal.crossVectors(edge.subVectors(b, a), c.clone().sub(a)).normalize()
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center)
      let wall = 0
      // Keep horizontal surfaces and partitions in the middle of the cargo area.
      // Winding is irrelevant: both skins of a thick wall disappear together.
      if (Math.abs(normal.x) > Math.abs(normal.y) * 1.5 && Math.abs(normal.x) >= Math.abs(normal.z) && Math.abs(centroid.x) > size.x * 0.3) {
        wall = centroid.x > 0 ? 1 : 2
      } else if (Math.abs(normal.z) > Math.abs(normal.y) * 1.5 && Math.abs(normal.z) > Math.abs(normal.x) && Math.abs(centroid.z) > size.z * 0.3) {
        wall = centroid.z > 0 ? 4 : 8
      }
      const group = original.groups.find((group) => i >= group.start && i < group.start + group.count)
      triangles.push({ indices, wall, material: group?.materialIndex ?? 0 })
    }
    if (!triangles.some((triangle) => triangle.wall !== 0)) return
    const geometry = original.clone()
    fullGeometries.set(geometry, original)
    entries.push({ mesh: object, original, geometry, triangles, views: new Map() })
  })

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
      for (const entry of entries) {
        if (mask === 0) {
          entry.mesh.geometry = entry.original
          continue
        }
        let view = entry.views.get(mask)
        if (!view) {
          const indices: number[] = []
          const groups: { start: number; count: number; materialIndex: number }[] = []
          for (const triangle of entry.triangles) {
            if (triangle.wall & mask) continue
            let group = groups[groups.length - 1]
            if (!group || group.materialIndex !== triangle.material) {
              group = { start: indices.length, count: 0, materialIndex: triangle.material }
              groups.push(group)
            }
            indices.push(...triangle.indices)
            group.count += 3
          }
          view = { index: new BufferAttribute(new Uint32Array(indices), 1), groups }
          entry.views.set(mask, view)
        }
        // Dispose cached GPU buffers before swapping to another index buffer.
        entry.geometry.dispose()
        entry.geometry.setIndex(view.index)
        entry.geometry.clearGroups()
        view.groups.forEach((group) => entry.geometry.addGroup(group.start, group.count, group.materialIndex))
        entry.geometry.setDrawRange(0, view.index.count)
        entry.mesh.geometry = entry.geometry
      }
    },
    dispose() {
      for (const entry of entries) {
        entry.mesh.geometry = entry.original
        fullGeometries.delete(entry.geometry)
        entry.geometry.dispose()
      }
    },
  }
}
