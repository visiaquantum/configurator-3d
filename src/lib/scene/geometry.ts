import { Box3, Euler, Mesh, Raycaster, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { PlacedItem, Vec3 } from '../types'

/** Snap coordinates are already in metres in the centred collider frame. */
export function rotateVector(vector: Vec3, rotation: Vec3): Vec3 {
  const value = new Vector3(...vector).applyEuler(new Euler(...rotation))
  return [value.x, value.y, value.z]
}

export function worldPoint(item: PlacedItem, local: Vec3, bodyHeight: number): Vec3 {
  const point = rotateVector(local, item.rotation)
  return [point[0] + item.position[0], point[1] + item.position[1] + bodyHeight / 2, point[2] + item.position[2]]
}

export function normalsOppose(a: Vec3 | undefined, aRotation: Vec3, b: Vec3 | undefined, bRotation: Vec3): boolean {
  if (!a || !b) return true
  const lengthA = Math.hypot(...a)
  const lengthB = Math.hypot(...b)
  if (lengthA < 1e-9 || lengthB < 1e-9) return false
  const aw = rotateVector(a, aRotation)
  const bw = rotateVector(b, bRotation)
  return (aw[0] * bw[0] + aw[1] * bw[1] + aw[2] * bw[2]) / (lengthA * lengthB) <= -0.9
}

/** Axis-aligned bounds of a box after a full XYZ Euler rotation. */
export function transformedBounds(item: PlacedItem, bodyHeight: number, center: Vec3, size: Vec3) {
  const position = worldPoint(item, center, bodyHeight)
  const axes = [rotateVector([size[0] / 2, 0, 0], item.rotation), rotateVector([0, size[1] / 2, 0], item.rotation), rotateVector([0, 0, size[2] / 2], item.rotation)]
  const half = [0, 1, 2].map((index) => axes.reduce((sum, axis) => sum + Math.abs(axis[index]), 0))
  return {
    min: position.map((value, index) => value - half[index]) as Vec3,
    max: position.map((value, index) => value + half[index]) as Vec3,
  }
}

const isMarker = (object: Object3D) =>
  /^(snap|anchor|rule)[_:]/i.test(object.name) || ['snap', 'anchor', 'rule'].includes(object.userData.kind)

/** Visible meshes of a body, skipping marker subtrees and hidden nodes. */
export function visibleBodyMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  const visit = (object: Object3D) => {
    if (!object.visible || isMarker(object)) return
    if (object instanceof Mesh) meshes.push(object)
    object.children.forEach(visit)
  }
  visit(root)
  return meshes
}

/**
 * Top of the cargo floor the model draws inside a `dimensions` footprint, in
 * world Y: rays cast straight down across the footprint stop on the first
 * surface in the lower quarter of the volume, and the median of those hits is
 * the floor. A model that draws no floor there rests on `base`.
 */
export function cargoFloorTop(root: Object3D, dimensions: Vec3, base = 0): number {
  root.updateWorldMatrix(true, true)
  const meshes = visibleBodyMeshes(root)
  const raycaster = new Raycaster()
  const down = new Vector3(0, -1, 0)
  const top = base + dimensions[1] / 2
  const ceiling = base + dimensions[1] / 4
  const hits: number[] = []
  for (const fx of [-0.25, 0, 0.25]) {
    for (const fz of [-0.25, 0, 0.25]) {
      raycaster.set(new Vector3(fx * dimensions[0], top, fz * dimensions[2]), down)
      const hit = raycaster.intersectObjects(meshes, false)[0]
      if (hit && hit.point.y <= ceiling && hit.point.y >= base - dimensions[1] / 4) hits.push(hit.point.y)
    }
  }
  if (hits.length === 0) return base
  hits.sort((a, b) => a - b)
  return Math.max(base, hits[Math.floor(hits.length / 2)])
}

/** Visible body bounds, excluding complete marker subtrees rather than their pivots. */
export function visibleBodyBounds(root: Object3D): Box3 {
  root.updateWorldMatrix(true, true)
  const bounds = new Box3()
  const scratch = new Box3()
  const visit = (object: Object3D) => {
    if (!object.visible || isMarker(object)) return
    if (object instanceof Mesh) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      if (object.geometry.boundingBox) bounds.union(scratch.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld))
    }
    object.children.forEach(visit)
  }
  visit(root)
  return bounds
}
