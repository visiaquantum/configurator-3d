import { Box3, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { ConfiguratorState, ConfiguratorStore } from '../state/store'
import type { IsometricExportOptions, IsometricViewImage } from '../types'
import { configurationStatus } from '../state/readiness'
import { hasBlockingIssues, validateConfiguration } from '../assembly/validation'
import { defaultIsometricViews } from '../scene/isometric'
import { captureCanvasBlob, captureCanvasImage, exportProjectPDF, exportSceneGLB } from './export'
import { exportIsometricSheetPDF, isometricSheetImageSize } from './isometricSheet'
import { renderIsometricDrawings } from './technicalDrawing'
import type { IsometricDrawing } from './technicalDrawing'

export type SceneExportKind = 'png' | 'glb' | 'pdf' | 'iso-pdf'

const pendingExports = new WeakMap<ConfiguratorStore, Promise<unknown>>()

/**
 * Run one export of a configurator. Exports of the same store run one at a
 * time; each refuses while an attachment is open, while data is still
 * loading, or when the project changes under it.
 */
function queueExport<T>(storeApi: ConfiguratorStore, kind: string, produce: (state: ConfiguratorState) => Promise<T>, size: (result: T) => number): Promise<T> {
  const previous = pendingExports.get(storeApi)
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => performExport(storeApi, kind, produce, size))
  pendingExports.set(storeApi, next)
  const cleanup = () => { if (pendingExports.get(storeApi) === next) pendingExports.delete(storeApi) }
  void next.then(cleanup, cleanup)
  return next
}

/** Export the scene of one configurator as a single file. */
export function exportSceneAsBlob(storeApi: ConfiguratorStore, kind: SceneExportKind, options: IsometricExportOptions = {}): Promise<Blob> {
  return queueExport(storeApi, kind, async (s) => {
    if (kind === 'iso-pdf') {
      const drawings = renderIsometricViews(s, options)
      return exportIsometricSheetPDF({
        project: s.project!,
        logo: options.logo,
        views: drawings.map(({ label, canvas }) => ({ label, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height })),
      })
    }
    return sceneBlob(s, kind)
  }, (blob) => blob.size)
}

/** Isometric line drawings of one configurator as PNG images, one per view. */
export function exportIsometricViewImages(storeApi: ConfiguratorStore, options: IsometricExportOptions = {}): Promise<IsometricViewImage[]> {
  return queueExport(storeApi, 'iso-png', async (s) => Promise.all(renderIsometricViews(s, options).map(async ({ view, label, canvas }) => ({
    view, label, width: canvas.width, height: canvas.height,
    blob: await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Impossibile creare l’immagine della vista'))),
      'image/png',
    )),
  }))), (images) => images.reduce((total, image) => total + image.blob.size, 0))
}

function renderIsometricViews(s: ConfiguratorState, options: IsometricExportOptions): IsometricDrawing[] {
  const refs = s.captureRefs
  const bbox = s.enclosureBBox
  if (!refs || !bbox) throw new Error('Scene not ready')
  const enclosureBounds = new Box3(new Vector3(...bbox.min), new Vector3(...bbox.max))
  const itemRoots: Object3D[] = [...s.itemRegistry.values()].map((registration) => registration.group)
  const enclosureRoots = s.collectExportRoots().filter((root) => !itemRoots.includes(root))
  const itemBounds = new Box3()
  for (const root of itemRoots) itemBounds.expandByObject(root)
  const views = options.views?.length
    ? options.views
    : defaultIsometricViews(bbox, itemBounds.isEmpty() ? null : { min: itemBounds.min.toArray(), max: itemBounds.max.toArray() })
  const size = isometricSheetImageSize(options.width)
  return renderIsometricDrawings({
    gl: refs.gl,
    enclosureRoots,
    itemRoots,
    enclosureBounds,
    views,
    width: options.width ?? size.width,
    height: options.height ?? size.height,
    highlight: options.highlight ?? true,
  })
}

async function sceneBlob(s: ConfiguratorState, kind: Exclude<SceneExportKind, 'iso-pdf'>): Promise<Blob> {
  const refs = s.captureRefs
  if (kind === 'png') {
    if (!refs) throw new Error('Scene not ready')
    return captureCanvasBlob(refs.gl, refs.scene, refs.camera)
  }
  if (kind === 'glb') {
    const roots = s.collectExportRoots()
    if (roots.length === 0) throw new Error('No exportable geometry')
    return exportSceneGLB(roots)
  }
  const issues = validateConfiguration(s.project, s.catalog, s.assemblyManifest, { itemSnaps: s.itemSnaps, itemRules: s.itemRules, itemSizes: s.itemSizes, enclosureBounds: s.interiorBBox })
  if (hasBlockingIssues(issues)) {
    throw new Error('La configurazione contiene errori bloccanti: correggili prima di esportare la BOM/PDF')
  }
  const imageDataUrl = refs
    ? captureCanvasImage(refs.gl, refs.scene, refs.camera, 'image/jpeg')
    : undefined
  const project = s.project
  if (!project) throw new Error('No project')
  return exportProjectPDF({
    project,
    catalog: Object.values(s.catalog),
    imageDataUrl,
    manifest: s.assemblyManifest,
    validationIssues: issues,
    validated: true,
  })
}

async function performExport<T>(storeApi: ConfiguratorStore, kind: string, produce: (state: ConfiguratorState) => Promise<T>, size: (result: T) => number): Promise<T> {
  if (storeApi.getState().attachment) throw new Error('Completa o annulla l’aggancio prima di esportare')
  const startedAt = performance.now()
  const selectedId = storeApi.getState().selectedId
  const initialProject = storeApi.getState().project
  const status = configurationStatus(storeApi.getState())
  if (!status.ready) throw new Error(status.message)
  if (kind === 'pdf' && !status.technical) throw new Error('Carica un manifest tecnico completo prima di esportare la BOM')
  try {
    // Deselect, then wait two frames: one for React to commit the unmount of
    // TransformControls/wireframe, one for R3F to render the clean scene.
    storeApi.getState().select(null)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const s = storeApi.getState()
    if (s.project !== initialProject) throw new Error('Il progetto è cambiato durante l’esportazione: riprova')
    const result = await produce(s)
    if (storeApi.getState().project !== initialProject) throw new Error('Il progetto è cambiato durante l’esportazione: riprova')
    s.reportTelemetry({ type: 'export', outcome: 'success', durationMs: performance.now() - startedAt, detail: { kind, size: size(result) } })
    return result
  } catch (error) {
    storeApi.getState().reportTelemetry({
      type: 'export', outcome: 'error', durationMs: performance.now() - startedAt,
      detail: { kind, message: (error as Error).message },
    })
    throw error
  } finally {
    if (storeApi.getState().project === initialProject) storeApi.getState().select(selectedId)
  }
}
