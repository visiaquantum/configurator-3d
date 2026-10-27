import type { ConfiguratorStore } from '../state/store'
import { configurationStatus } from '../state/readiness'
import { hasBlockingIssues, validateConfiguration } from '../assembly/validation'
import { captureCanvasBlob, captureCanvasImage, exportProjectPDF, exportSceneGLB } from './export'

export type SceneExportKind = 'png' | 'glb' | 'pdf'

const pendingExports = new WeakMap<ConfiguratorStore, Promise<Blob>>()

/**
 * Export the scene of one configurator. Exports of the same store run one at
 * a time; each refuses while an attachment is open, while data is still
 * loading, or when the project changes under it.
 */
export function exportSceneAsBlob(storeApi: ConfiguratorStore, kind: SceneExportKind): Promise<Blob> {
  const previous = pendingExports.get(storeApi)
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => performSceneExport(storeApi, kind))
  pendingExports.set(storeApi, next)
  const cleanup = () => { if (pendingExports.get(storeApi) === next) pendingExports.delete(storeApi) }
  void next.then(cleanup, cleanup)
  return next
}

async function performSceneExport(storeApi: ConfiguratorStore, kind: SceneExportKind): Promise<Blob> {
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
    const refs = s.captureRefs
    let blob: Blob
    if (kind === 'png') {
      if (!refs) throw new Error('Scene not ready')
      blob = await captureCanvasBlob(refs.gl, refs.scene, refs.camera)
    } else if (kind === 'glb') {
      const roots = s.collectExportRoots()
      if (roots.length === 0) throw new Error('No exportable geometry')
      blob = await exportSceneGLB(roots)
    } else {
      const issues = validateConfiguration(s.project, s.catalog, s.assemblyManifest, { itemSnaps: s.itemSnaps, itemRules: s.itemRules, itemSizes: s.itemSizes, enclosureBounds: s.interiorBBox })
      if (hasBlockingIssues(issues)) {
        throw new Error('La configurazione contiene errori bloccanti: correggili prima di esportare la BOM/PDF')
      }
      const imageDataUrl = refs
        ? captureCanvasImage(refs.gl, refs.scene, refs.camera, 'image/jpeg')
        : undefined
      const project = s.project
      if (!project) throw new Error('No project')
      blob = await exportProjectPDF({
        project,
        catalog: Object.values(s.catalog),
        imageDataUrl,
        manifest: s.assemblyManifest,
        validationIssues: issues,
        validated: true,
      })
    }
    if (storeApi.getState().project !== initialProject) throw new Error('Il progetto è cambiato durante l’esportazione: riprova')
    s.reportTelemetry({ type: 'export', outcome: 'success', durationMs: performance.now() - startedAt, detail: { kind, size: blob.size } })
    return blob
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
