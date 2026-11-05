import { Box3, OrthographicCamera, Vector3 } from 'three'
import type { IsometricView } from '../types'

/*
 * The four isometric views: the camera sits on a top corner of the enclosure
 * and looks along a (±1, -1, ±1) diagonal. Names follow the camera presets
 * (`+Z` is the front, `+X` the right side).
 */

export const ISOMETRIC_VIEWS: readonly IsometricView[] = ['iso', 'iso-front-left', 'iso-back-right', 'iso-back-left']

export const ISOMETRIC_VIEW_LABELS: Record<IsometricView, string> = {
  iso: 'Vista isometrica anteriore destra',
  'iso-front-left': 'Vista isometrica anteriore sinistra',
  'iso-back-right': 'Vista isometrica posteriore destra',
  'iso-back-left': 'Vista isometrica posteriore sinistra',
}

/** Side of the enclosure centre the camera stands on, along X and Z. */
const CORNERS: Record<IsometricView, [x: 1 | -1, z: 1 | -1]> = {
  iso: [1, 1],
  'iso-front-left': [-1, 1],
  'iso-back-right': [1, -1],
  'iso-back-left': [-1, -1],
}

export function isIsometricView(value: unknown): value is IsometricView {
  return typeof value === 'string' && (ISOMETRIC_VIEWS as readonly string[]).includes(value)
}

/** Unit vector from the scene centre towards the camera. */
export function isometricOffset(view: IsometricView): Vector3 {
  const [x, z] = CORNERS[view]
  return new Vector3(x, 1, z).normalize()
}

interface Bounds { min: readonly number[]; max: readonly number[] }

/**
 * The views that show the products from the inside of the enclosure. The cut
 * walls are those on the camera's side, so a camera on the same side as the
 * products would only see their backs. Along the enclosure's width (its
 * shorter horizontal side) the camera goes opposite the products; along its
 * length both ends are useful. Products in the middle keep all four views.
 */
export function defaultIsometricViews(enclosure: Bounds, items: Bounds | null): IsometricView[] {
  if (!items) return [...ISOMETRIC_VIEWS]
  const axis = enclosure.max[0] - enclosure.min[0] <= enclosure.max[2] - enclosure.min[2] ? 0 : 2
  const width = enclosure.max[axis] - enclosure.min[axis]
  const offset = (items.min[axis] + items.max[axis]) / 2 - (enclosure.min[axis] + enclosure.max[axis]) / 2
  if (!(width > 0) || Math.abs(offset) < width * 0.1) return [...ISOMETRIC_VIEWS]
  const side = offset > 0 ? -1 : 1
  return ISOMETRIC_VIEWS.filter((view) => CORNERS[view][axis === 0 ? 0 : 1] === side)
}

/**
 * Point an orthographic camera along the view and fit `bounds` into an image
 * of the given aspect, with `margin` (fraction of the frame) left free.
 */
export function frameIsometricCamera(camera: OrthographicCamera, view: IsometricView, bounds: Box3, aspect: number, margin = 0.04): OrthographicCamera {
  const center = bounds.getCenter(new Vector3())
  const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.05)
  camera.position.copy(center).addScaledVector(isometricOffset(view), radius * 2)
  camera.up.set(0, 1, 0)
  camera.lookAt(center)
  camera.zoom = 1
  camera.updateMatrixWorld(true)

  const inverse = camera.matrixWorldInverse
  const projected = new Box3()
  const corner = new Vector3()
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) projected.expandByPoint(corner.set(x, y, z).applyMatrix4(inverse))
    }
  }
  const midX = (projected.min.x + projected.max.x) / 2
  const midY = (projected.min.y + projected.max.y) / 2
  let halfWidth = (projected.max.x - projected.min.x) / 2 / (1 - 2 * margin)
  let halfHeight = (projected.max.y - projected.min.y) / 2 / (1 - 2 * margin)
  if (halfWidth / halfHeight > aspect) halfHeight = halfWidth / aspect
  else halfWidth = halfHeight * aspect
  camera.left = midX - halfWidth
  camera.right = midX + halfWidth
  camera.top = midY + halfHeight
  camera.bottom = midY - halfHeight
  camera.near = Math.max(radius * 0.01, 0.001)
  camera.far = radius * 4
  camera.updateProjectionMatrix()
  return camera
}

/** Pixel rectangle covering `box` in an image of `width` × `height` drawn with `camera`. */
export function projectedRect(box: Box3, camera: OrthographicCamera, width: number, height: number) {
  const point = new Vector3()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        point.set(x, y, z).project(camera)
        const px = (point.x + 1) / 2 * width
        const py = (1 - point.y) / 2 * height
        minX = Math.min(minX, px); maxX = Math.max(maxX, px)
        minY = Math.min(minY, py); maxY = Math.max(maxY, py)
      }
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
