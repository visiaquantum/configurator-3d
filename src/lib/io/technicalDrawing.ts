import {
  Box3, BufferGeometry, Color, DoubleSide, EdgesGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  OrthographicCamera, SRGBColorSpace, Scene, Vector2, WebGLRenderTarget,
} from 'three'
import type { Object3D, WebGLRenderer } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { IsometricView } from '../types'
import { createEnclosureCutaway, enclosureGeometryForExport } from '../scene/enclosureCutaway'
import { ISOMETRIC_VIEW_LABELS, frameIsometricCamera, projectedRect } from '../scene/isometric'

/**
 * Line drawings in the style of a quote's technical sheets: white faces, the
 * visible edges of the products in dark lines, the enclosure in light lines
 * with the walls on the camera's side cut away. Hidden lines are removed by
 * the faces' depth.
 */
export const DRAWING_STYLE = {
  background: '#ffffff',
  itemLine: '#262626',
  enclosureLine: '#a3a3a3',
  highlight: '#e3241b',
  /** Line widths as a fraction of the image width (1.6 px at 2400 px). */
  itemLineWidth: 1.6 / 2400,
  enclosureLineWidth: 1.1 / 2400,
  /** Faces meeting at less than this angle (degrees) draw no edge. */
  thresholdAngle: 30,
}

// Edges depend only on the geometry: computed once, reused by every view.
const edgeCache = new WeakMap<BufferGeometry, Float32Array>()
function edgePositions(geometry: BufferGeometry): Float32Array {
  const cached = edgeCache.get(geometry)
  if (cached) return cached
  const edges = new EdgesGeometry(geometry, DRAWING_STYLE.thresholdAngle)
  const positions = new Float32Array(edges.getAttribute('position').array)
  edges.dispose()
  edgeCache.set(geometry, positions)
  return positions
}

/** Visible meshes under `root`, skipping editor helpers and their children. */
function visibleMeshes(root: Object3D, visit: (mesh: Mesh) => void) {
  if (!root.visible || root.userData.configuratorHelper) return
  if (root instanceof Mesh) visit(root)
  for (const child of root.children) visibleMeshes(child, visit)
}

/** World matrices a mesh is drawn with: one, or one per instance. */
function worldMatrices(mesh: Mesh): Matrix4[] {
  if (!(mesh instanceof InstancedMesh)) return [mesh.matrixWorld.clone()]
  return Array.from({ length: mesh.count }, (_, index) => {
    const matrix = new Matrix4()
    mesh.getMatrixAt(index, matrix)
    return matrix.premultiply(mesh.matrixWorld)
  })
}

export interface DrawingSceneInput {
  /** Enclosure roots (cut per view) and placed item roots, as live scene objects. */
  enclosureRoots: Object3D[]
  itemRoots: Object3D[]
  /** Enclosure AABB, the reference for the wall cut. */
  enclosureBounds: Box3
  view: IsometricView
  width: number
  height: number
}

export interface DrawingScene {
  scene: Scene
  camera: OrthographicCamera
  /** World AABB of the products, or null when there are none. */
  itemBounds: Box3 | null
  dispose(): void
}

/**
 * Build the drawing of one view out of the live scene, without touching it:
 * meshes are new objects sharing the live geometries.
 */
export function buildDrawingScene({ enclosureRoots, itemRoots, enclosureBounds, view, width, height }: DrawingSceneInput): DrawingScene {
  const scene = new Scene()
  const resolution = new Vector2(width, height)
  const fill = new MeshBasicMaterial({
    color: DRAWING_STYLE.background, side: DoubleSide,
    // Faces sit just behind their own edges, so the edges win the depth test.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  })
  const line = (color: string, fraction: number) => new LineMaterial({ color: new Color(color), linewidth: Math.max(1, fraction * width), worldUnits: false, resolution })
  const itemLines = line(DRAWING_STYLE.itemLine, DRAWING_STYLE.itemLineWidth)
  const enclosureLines = line(DRAWING_STYLE.enclosureLine, DRAWING_STYLE.enclosureLineWidth)
  const lineGeometries: LineSegmentsGeometry[] = []
  const cleanups: (() => void)[] = []

  const add = (mesh: Mesh, geometry: BufferGeometry, lines: LineMaterial) => {
    const edges = edgePositions(geometry)
    const segments = edges.length > 0 ? new LineSegmentsGeometry().setPositions(edges) : null
    if (segments) lineGeometries.push(segments)
    for (const matrix of worldMatrices(mesh)) {
      const face = new Mesh(geometry, fill)
      face.matrixAutoUpdate = false
      face.matrix.copy(matrix)
      scene.add(face)
      if (!segments) continue
      const edge = new LineSegments2(segments, lines)
      edge.matrixAutoUpdate = false
      edge.matrix.copy(matrix)
      scene.add(edge)
    }
  }

  // Items first: their bounds frame the view together with the enclosure.
  const itemBox = new Box3()
  for (const root of itemRoots) {
    root.updateWorldMatrix(true, true)
    visibleMeshes(root, (mesh) => {
      const geometry = enclosureGeometryForExport(mesh.geometry)
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      for (const matrix of worldMatrices(mesh)) {
        itemBox.union(geometry.boundingBox!.clone().applyMatrix4(matrix))
      }
      add(mesh, geometry, itemLines)
    })
  }

  const itemBounds = itemBox.isEmpty() ? null : itemBox
  const framed = enclosureBounds.clone().union(itemBox)
  const camera = frameIsometricCamera(new OrthographicCamera(), view, framed, width / height)

  for (const root of enclosureRoots) {
    // Cut a copy: the live enclosure keeps the cut of the editor's camera.
    root.updateWorldMatrix(true, true)
    const copy = root.clone(true)
    root.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale)
    copy.traverse((object) => { if (object instanceof Mesh) object.geometry = enclosureGeometryForExport(object.geometry) })
    const cutaway = createEnclosureCutaway(copy, enclosureBounds)
    cutaway.update(camera, true, true)
    copy.updateWorldMatrix(true, true)
    visibleMeshes(copy, (mesh) => add(mesh, mesh.geometry, enclosureLines))
    cleanups.push(() => cutaway.dispose())
  }

  scene.updateMatrixWorld(true)
  return {
    scene,
    camera,
    itemBounds,
    dispose() {
      cleanups.forEach((cleanup) => cleanup())
      lineGeometries.forEach((geometry) => geometry.dispose())
      fill.dispose(); itemLines.dispose(); enclosureLines.dispose()
    },
  }
}

/** Render `scene` offscreen at `width` × `height` and copy it to a 2D canvas. */
function renderToCanvas(gl: WebGLRenderer, scene: Scene, camera: OrthographicCamera, width: number, height: number): HTMLCanvasElement {
  // An sRGB target stores what a screen would show: colours are encoded on
  // write, and antialiasing blends in linear space as on screen.
  const target = new WebGLRenderTarget(width, height, { samples: Math.min(4, gl.capabilities.maxSamples) })
  target.texture.colorSpace = SRGBColorSpace
  const previousTarget = gl.getRenderTarget()
  const previousClear = gl.getClearColor(new Color())
  const previousAlpha = gl.getClearAlpha()
  const pixels = new Uint8Array(width * height * 4)
  try {
    gl.setRenderTarget(target)
    gl.setClearColor(DRAWING_STYLE.background, 1)
    gl.clear()
    gl.render(scene, camera)
    gl.readRenderTargetPixels(target, 0, 0, width, height, pixels)
  } finally {
    gl.setRenderTarget(previousTarget)
    gl.setClearColor(previousClear, previousAlpha)
    target.dispose()
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Impossibile creare l’immagine della vista')
  const image = context.createImageData(width, height)
  // WebGL rows start at the bottom.
  const row = width * 4
  for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row)
  context.putImageData(image, 0, 0)
  return canvas
}

export interface IsometricDrawingInput {
  gl: WebGLRenderer
  enclosureRoots: Object3D[]
  itemRoots: Object3D[]
  enclosureBounds: Box3
  views: IsometricView[]
  width: number
  height: number
  /** Outline the products with a red frame. */
  highlight: boolean
}

export interface IsometricDrawing {
  view: IsometricView
  label: string
  canvas: HTMLCanvasElement
}

/** One line drawing per view, in order. */
export function renderIsometricDrawings({ gl, enclosureRoots, itemRoots, enclosureBounds, views, width, height, highlight }: IsometricDrawingInput): IsometricDrawing[] {
  const maxSize = Math.min(gl.capabilities.maxTextureSize, 8192)
  const scale = Math.min(1, maxSize / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return views.map((view) => {
    const drawing = buildDrawingScene({ enclosureRoots, itemRoots, enclosureBounds, view, width: w, height: h })
    try {
      const canvas = renderToCanvas(gl, drawing.scene, drawing.camera, w, h)
      if (highlight && drawing.itemBounds) {
        const rect = projectedRect(drawing.itemBounds, drawing.camera, w, h)
        const pad = w * 0.012
        const context = canvas.getContext('2d')!
        context.strokeStyle = DRAWING_STYLE.highlight
        context.lineWidth = Math.max(2, w * 0.0018)
        context.strokeRect(rect.x - pad, rect.y - pad, rect.width + pad * 2, rect.height + pad * 2)
      }
      return { view, label: ISOMETRIC_VIEW_LABELS[view], canvas }
    } finally {
      drawing.dispose()
    }
  })
}
