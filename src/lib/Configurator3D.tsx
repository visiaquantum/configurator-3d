import { useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { Scene } from './scene/Scene'
import { Inspector } from './ui/Inspector'
import { AttachmentOverlay } from './ui/AttachmentOverlay'
import { configuratorStyles } from './ui/styles'
import { Icon } from './ui/Icon'
import { ConfiguratorStoreContext, createConfiguratorStore, useConfiguratorStore, useConfiguratorStoreApi } from './state/store'
import type { ConfiguratorStore } from './state/store'
import { ConfiguratorStoreProvider } from './state/ConfiguratorStoreProvider'
import { configurationStatus, validationForState } from './state/readiness'
import { loadCatalog } from './io/catalog'
import { hasBlockingIssues, validateConfiguration } from './assembly/validation'
import { inferLegacyConnections, loadAssemblyManifest } from './assembly/manifest'
import {
  captureCanvasImage,
  downloadBlob,
  exportProjectPDF,
  exportSceneGLB,
} from './io/export'
import { PROJECT_SCHEMA_VERSION } from './types'
import type {
  CatalogItem,
  Configurator3DProps,
  ConfiguratorHandle,
  EnclosureData,
  PlacedItem,
  ProjectData,
  ValidationIssue,
  Vec3,
} from './types'

export function Configurator3D(props: Configurator3DProps) {
  const inherited = useContext(ConfiguratorStoreContext)
  const [owned] = useState(createConfiguratorStore)
  const store = props.store ?? inherited ?? owned
  return <ConfiguratorStoreProvider store={store}><ConfiguratorContent {...props} /></ConfiguratorStoreProvider>
}

function ConfiguratorContent({
  ref,
  enclosure,
  initialItems,
  projectId,
  metadata,
  catalog,
  assemblyManifest,
  onChange,
  onSave,
  onCatalogLoaded,
  onCatalogError,
  onValidationChange,
  onTelemetry,
  showInspector = true,
  showToolbar = true,
  showHints = true,
  readOnly,
  className,
  style,
  environmentUrl,
  theme = 'light',
}: Configurator3DProps) {
  const storeApi = useConfiguratorStoreApi()
  const containerRef = useRef<HTMLDivElement>(null)
  const setProject = useConfiguratorStore((s) => s.setProject)
  const setCatalog = useConfiguratorStore((s) => s.setCatalog)
  const setReadOnly = useConfiguratorStore((s) => s.setReadOnly)
  const project = useConfiguratorStore((s) => s.project)
  const attachment = useConfiguratorStore((s) => s.attachment)
  const attachmentStage = attachment?.stage
  const manifest = useConfiguratorStore((s) => s.assemblyManifest)
  const validationIssues = useConfiguratorStore((s) => s.validationIssues)
  const itemSnaps = useConfiguratorStore((s) => s.itemSnaps)
  const itemRules = useConfiguratorStore((s) => s.itemRules)
  const catalogEntries = useConfiguratorStore((s) => s.catalog)
  const itemSizes = useConfiguratorStore((s) => s.itemSizes)
  const interiorBBox = useConfiguratorStore((s) => s.interiorBBox)
  const captureRefs = useConfiguratorStore((s) => s.captureRefs)
  const enclosureBBox = useConfiguratorStore((s) => s.enclosureBBox)
  const loadingCatalog = useConfiguratorStore((s) => s.loadingCatalog)
  const loadingManifest = useConfiguratorStore((s) => s.loadingManifest)
  const catalogError = useConfiguratorStore((s) => s.catalogError)
  const assetErrors = useConfiguratorStore((s) => s.assetErrors)
  const listeners = useRef({ onChange, onValidationChange })
  useEffect(() => {
    if (attachmentStage && attachmentStage !== 'menu') containerRef.current?.focus({ preventScroll: true })
  }, [attachmentStage])
  const validationReported = useRef(false)
  useEffect(() => { listeners.current = { onChange, onValidationChange } }, [onChange, onValidationChange])

  // Build the project once when any of the source props change (reference compare).
  // Host should memoize these to control when the scene resets.
  const builtProject = useMemo<ProjectData>(() => {
    const enclosureData: EnclosureData =
      typeof enclosure === 'string' ? { glbUrl: enclosure } : enclosure
    const hasLegacyLinks = initialItems?.some((item) =>
      item.constraints?.some((constraint) => constraint.type === 'snapToItem'),
    ) ?? false
    return {
      id: projectId ?? `cfg-${nanoid(8)}`,
      version: PROJECT_SCHEMA_VERSION,
      enclosure: enclosureData,
      items: initialItems ?? [],
      // A new scene owns an explicit empty graph. Leave legacy links without
      // the field so they can be upgraded once their GLB snaps hydrate.
      connections: hasLegacyLinks ? undefined : [],
      metadata,
    }
  }, [enclosure, initialItems, projectId, metadata])

  // Resolve catalog: inline array passes through; URL string is fetched + validated.
  const catalogUrl = typeof catalog === 'string' ? catalog : null
  const [fetched, setFetched] = useState<
    { url: string; items: CatalogItem[] } | { url: string; error: string } | null
  >(null)
  const manifestError = useConfiguratorStore((s) => s.manifestError)

  useEffect(() => {
    storeApi.getState().setTelemetryListener(onTelemetry ?? null)
    return () => storeApi.getState().setTelemetryListener(null)
  }, [onTelemetry, storeApi])

  const catalogCallbacks = useRef({ onCatalogLoaded, onCatalogError })
  useEffect(() => { catalogCallbacks.current = { onCatalogLoaded, onCatalogError } }, [onCatalogLoaded, onCatalogError])
  useEffect(() => {
    if (!catalog) {
      storeApi.setState({ loadingCatalog: false, catalogError: null })
      setCatalog([])
      return
    }
    const controller = new AbortController()
    const startedAt = performance.now()
    storeApi.setState({ loadingCatalog: true, catalogError: null })
    if (typeof catalog === 'string') setCatalog([])
    loadCatalog(catalog, controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setCatalog(items)
      storeApi.setState({ loadingCatalog: false })
      setFetched({ url: catalogUrl ?? 'inline', items })
      // Models load on demand. Preloading the entire catalog can exhaust memory
      // and puts failures outside the per-model error boundary.
      storeApi.getState().reportTelemetry({ type: 'catalog-load', outcome: 'success', durationMs: performance.now() - startedAt, detail: { itemCount: items.length } })
      catalogCallbacks.current.onCatalogLoaded?.(items)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      const error = cause instanceof Error ? cause : new Error(String(cause))
      storeApi.setState({ loadingCatalog: false, catalogError: error.message })
      setFetched({ url: catalogUrl ?? 'inline', error: error.message })
      storeApi.getState().reportTelemetry({ type: 'catalog-load', outcome: 'error', durationMs: performance.now() - startedAt, detail: { message: error.message } })
      catalogCallbacks.current.onCatalogError?.(error)
    })
    return () => controller.abort()
  }, [catalog, catalogUrl, setCatalog, storeApi])

  useEffect(() => {
    storeApi.setState({ loadingManifest: !!assemblyManifest, manifestError: null, assemblyManifest: null })
    if (!assemblyManifest) {
      storeApi.getState().setAssemblyManifest(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const startedAt = performance.now()
    loadAssemblyManifest(assemblyManifest, controller.signal)
      .then((next) => {
        if (cancelled) return
        storeApi.setState({ loadingManifest: false })
        storeApi.getState().setAssemblyManifest(next)
        storeApi.getState().reportTelemetry({
          type: 'manifest-load', outcome: 'success', durationMs: performance.now() - startedAt,
          detail: { version: next.version, productCount: next.products.length },
        })
      })
      .catch((error: Error) => {
        if (cancelled) return
        storeApi.setState({ loadingManifest: false, manifestError: error.message })
        storeApi.getState().setAssemblyManifest(null)
        storeApi.getState().reportTelemetry({
          type: 'manifest-load', outcome: 'error', durationMs: performance.now() - startedAt,
          detail: { message: error.message },
        })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [assemblyManifest, storeApi])

  const catalogStatus: { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string } =
    !catalogUrl
      ? { state: 'idle' }
      : !fetched || fetched.url !== catalogUrl
        ? { state: 'loading' }
        : 'error' in fetched
          ? { state: 'error', message: fetched.error }
          : { state: 'idle' }

  useEffect(() => {
    setReadOnly(!!readOnly)
  }, [readOnly, setReadOnly])

  useEffect(() => {
    setProject(builtProject)
  }, [builtProject, setProject])

  useEffect(() => {
    if (project) listeners.current.onChange?.(structuredClone(project))
  }, [project])

  useEffect(() => {
    const issues = validationForState(storeApi.getState())
    const current = storeApi.getState().validationIssues
    const same = current.length === issues.length && current.every((issue, i) =>
      issue.level === issues[i].level && issue.code === issues[i].code && issue.message === issues[i].message && JSON.stringify(issue.itemIds) === JSON.stringify(issues[i].itemIds),
    )
    if (!same) {
      storeApi.getState().setValidationIssues(issues)
      storeApi.getState().reportTelemetry({
        type: 'validation',
        outcome: issues.some((issue) => issue.level === 'error') ? 'error' : 'success',
        detail: { issueCount: issues.length, errorCount: issues.filter((issue) => issue.level === 'error').length },
      })
    }
    if (!same || !validationReported.current) {
      validationReported.current = true
      listeners.current.onValidationChange?.(structuredClone(issues))
    }
  }, [project, catalogEntries, manifest, itemSnaps, itemRules, itemSizes, interiorBBox, captureRefs, enclosureBBox, loadingCatalog, loadingManifest, catalogError, manifestError, assetErrors, storeApi])

  useEffect(() => {
    if (!project || project.connections !== undefined || !manifest) return
    if (project.items.some((item) => !Object.hasOwn(itemSnaps, item.catalogId))) return
    const inferred = inferLegacyConnections(project, manifest, itemSnaps, itemRules)
    // Wait for GLB snap hydration; an empty result may simply mean that assets
    // are still loading, so do not freeze migration prematurely.
    const legacyCount = project.items.filter((item) => item.constraints?.some((c) => c.type === 'snapToItem')).length
    if (inferred.length === legacyCount) storeApi.getState().setConnections(inferred)
  }, [project, manifest, itemSnaps, itemRules, storeApi])

  // Global keyboard shortcuts
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return
      if ((e.target as HTMLElement | null)?.isContentEditable) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const s = storeApi.getState()
      if (s.attachment) {
        if (e.key === 'Escape') { e.preventDefault(); s.setAttachment(null) }
        return
      }
      // Walk mode owns the keyboard (WASD/Esc/Shift handled in WalkControls).
      if (s.walkMode) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        s.redo()
      } else if (e.key === 'Escape') {
        s.select(null)
      } else if (e.key === 't' || e.key === 'T') {
        s.setGizmoMode('translate')
      } else if (e.key === 'r' || e.key === 'R') {
        s.setGizmoMode('rotate')
      } else if ((e.key === 'f' || e.key === 'F') && s.selectedId) {
        s.requestFocusSelected()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) {
        s.removeItem(s.selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, storeApi])

  // Imperative API exposed to host via ref.
  useImperativeHandle(
    ref,
    (): ConfiguratorHandle => ({
      addItem(product, opts) {
        return addItemToScene(storeApi, product, opts)
      },
      removeItem(id) {
        storeApi.getState().removeItem(id)
      },
      selectItem(id) {
        storeApi.getState().select(id)
      },
      getProject() {
        return storeApi.getState().exportProject()
      },
      getValidation() {
        return structuredClone(validationForState(storeApi.getState()))
      },
      setProject(p) {
        storeApi.getState().setProject(p)
      },
      undo() {
        storeApi.getState().undo()
      },
      redo() {
        storeApi.getState().redo()
      },
      exportPNG: () => exportSceneAsBlob(storeApi, 'png'),
      exportGLB: () => exportSceneAsBlob(storeApi, 'glb'),
      exportPDF: () => exportSceneAsBlob(storeApi, 'pdf'),
    }),
    [storeApi],
  )

  if (!project) return null

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPointerDownCapture={(event) => {
        const element = event.target as HTMLElement
        if (!element.closest('input,textarea,select,button,[contenteditable]')) containerRef.current?.focus({ preventScroll: true })
      }}
      className={`cfg-ui ${className ?? ''}`}
      data-theme={theme}
      style={{ position: 'relative', width: '100%', height: '100%', cursor: attachment ? attachment.hoveredItemId || attachment.hoveredPointId ? 'pointer' : 'crosshair' : 'grab', ...style }}
    >
      <style>{configuratorStyles}</style>
      <Scene project={project} environmentUrl={environmentUrl} theme={theme} />
      <AttachmentOverlay />
      <div className="cfg-inspector-column" style={inspectorColumnStyle}>
        {showInspector && <Inspector readOnly={readOnly} />}
        {!attachment && <ValidationPanel issues={validationIssues} />}
      </div>
      {showHints && !attachment && <Hints />}
      <ViewControls />
      <ClearanceOverlay />
      <WalkHint />
      {catalogStatus.state === 'loading' && (
        <CatalogStatusBadge text="Caricamento catalogo…" tone="info" />
      )}
      {catalogStatus.state === 'error' && (
        <CatalogStatusBadge text={`Catalogo: ${catalogStatus.message}`} tone="error" />
      )}
      {assemblyManifest && manifestError && (
        <CatalogStatusBadge text={`Manifest: ${manifestError}`} tone="error" />
      )}
      {showToolbar && <Toolbar readOnly={readOnly} onSave={onSave} />}
      {!attachment && !project.items.length && <div className="cfg-empty-hint">Aggiungi un componente dal catalogo per iniziare</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Imperative helpers — read/write store from anywhere. The component's ref
// API delegates to these; they're also used by the built-in Toolbar.
// ---------------------------------------------------------------------------

function addItemToScene(
  storeApi: ConfiguratorStore,
  product: CatalogItem,
  opts?: { position?: Vec3; select?: boolean },
): string {
  const s = storeApi.getState()
  if (!s.project || s.readOnly) throw new Error('Il progetto non è modificabile')
  s.addCatalogItem(product)
  const items = s.project?.items ?? []
  const last = items[items.length - 1]
  const lastCat = last ? s.catalog[last.catalogId] : undefined
  const gap = 0.05
  const lastScale = lastCat?.scale ?? 1
  const nextScale = product.scale ?? 1
  const stepSize = (lastCat?.size?.[0] ?? 0.1) * lastScale || (product.size?.[0] ?? 0.1) * nextScale
  const bounds = s.interiorBBox ?? s.enclosureBBox
  const floorY = bounds?.min[1] ?? 0
  const position: Vec3 =
    opts?.position ??
    (last
      ? [last.position[0] + stepSize + gap, Math.max(last.position[1], floorY), last.position[2]]
      : [0, floorY, 0])
  const id = nanoid(8)
  const placed: PlacedItem = {
    id,
    catalogId: product.id,
    position,
    rotation: [0, 0, 0],
  }
  s.addItem(placed)
  if (opts?.select !== false) s.select(id)
  return id
}

const pendingExports = new WeakMap<ConfiguratorStore, Promise<Blob>>()
function exportSceneAsBlob(storeApi: ConfiguratorStore, kind: 'png' | 'glb' | 'pdf'): Promise<Blob> {
  const previous = pendingExports.get(storeApi)
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => performSceneExport(storeApi, kind))
  pendingExports.set(storeApi, next)
  const cleanup = () => { if (pendingExports.get(storeApi) === next) pendingExports.delete(storeApi) }
  void next.then(cleanup, cleanup)
  return next
}

async function performSceneExport(storeApi: ConfiguratorStore, kind: 'png' | 'glb' | 'pdf'): Promise<Blob> {
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
      const dataUrl = captureCanvasImage(refs.gl, refs.scene, refs.camera)
      blob = await (await fetch(dataUrl)).blob()
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

// ---------------------------------------------------------------------------
// Built-in UI panels — all opt-out via show* props.
// ---------------------------------------------------------------------------

function Toolbar({
  readOnly,
  onSave,
}: {
  readOnly?: boolean
  onSave?: (p: ProjectData) => void
}) {
  const storeApi = useConfiguratorStoreApi()
  const [busy, setBusy] = useState(false)
  const [exportsOpen, setExportsOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const state = useConfiguratorStore((s) => s)
  useEffect(() => storeApi.subscribe((current, previous) => {
    if (current.attachment && current.attachment !== previous.attachment) setExportsOpen(false)
  }), [storeApi])
  useEffect(() => {
    if (!exportsOpen) return
    const dismiss = (event: PointerEvent) => { if (!toolbarRef.current?.contains(event.target as Node)) setExportsOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && toolbarRef.current?.contains(document.activeElement)) { event.stopPropagation(); setExportsOpen(false) } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [exportsOpen])
  const status = configurationStatus(state)
  const projectId = useConfiguratorStore((s) => s.project?.id ?? 'scene')
  const validationIssues = useConfiguratorStore((s) => s.validationIssues)
  const canExportBom = status.ready && status.technical && !hasBlockingIssues(validationIssues)
  const download = async (kind: 'png' | 'glb' | 'pdf') => {
    setBusy(true)
    setExportsOpen(false)
    setError(null)
    try {
      const blob = await exportSceneAsBlob(storeApi, kind)
      downloadBlob(blob, `${projectId}.${kind}`)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={toolbarRef} className="cfg-export-toolbar" style={toolbarStyle}>
      {error && <span role="alert" style={{ color: 'var(--cfg-error)', maxWidth: 220, fontSize: 11 }}>{error}</span>}
      {onSave && <button className="cfg-button cfg-primary" disabled={readOnly || !!state.attachment} onClick={() => { const current = storeApi.getState().project; if (current) onSave(structuredClone(current)) }}><Icon name="save" size={15} />Salva</button>}
      <div style={{ position: 'relative' }}>
        <button className="cfg-button" disabled={busy || !!state.attachment} aria-expanded={exportsOpen} onClick={() => setExportsOpen(!exportsOpen)}><Icon name="download" size={16} />{busy ? 'Esportazione…' : 'Esporta'}</button>
        {exportsOpen && <div className="cfg-export-menu">
          <button className="cfg-menu-action" disabled={!status.ready} onClick={() => void download('png')}><Icon name="eye" size={16} />Immagine PNG</button>
          <button className="cfg-menu-action" disabled={!status.ready} onClick={() => void download('glb')}><Icon name="cube" size={16} />Modello 3D · GLB</button>
          <button className="cfg-menu-action" disabled={!canExportBom} onClick={() => void download('pdf')} title={canExportBom ? 'Distinta componenti e configurazione' : 'Completa la validazione prima di esportare'}><Icon name="layers" size={16} />Distinta PDF</button>
          <button className="cfg-menu-action" onClick={() => setExportsOpen(false)}><Icon name="close" size={16} />Chiudi</button>
        </div>}
      </div>
    </div>
  )
}

function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  const select = useConfiguratorStore((state) => state.select)
  const errors = issues.filter((issue) => issue.level === 'error')
  const state = useConfiguratorStore((s) => s)
  const status = configurationStatus(state)
  if (!status.ready || !status.technical) {
    return <div style={validationStyle}>{status.message}</div>
  }
  if (issues.length === 0) {
    return <div style={{ ...validationStyle, borderColor: 'var(--cfg-success-line)', color: 'var(--cfg-success)', display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="check" size={14} />Configurazione valida</div>
  }
  return (
    <div style={{ ...validationStyle, borderColor: errors.length ? 'var(--cfg-error-line)' : 'var(--cfg-warning-line)' }}>
      <div style={{ color: errors.length ? 'var(--cfg-error)' : 'var(--cfg-warning)', fontWeight: 600, marginBottom: 4 }}>
        {errors.length ? `${errors.length} errore${errors.length === 1 ? '' : 'i'} da correggere` : 'Avvisi configurazione'}
      </div>
      {issues.slice(0, 3).map((issue, index) => (
        <button
          key={`${issue.code}-${index}`}
          type="button"
          onClick={() => select(issue.itemIds[0] ?? null)}
          style={{ display: 'block', padding: 0, color: 'var(--cfg-text-muted)', background: 'transparent', border: 0, cursor: issue.itemIds[0] ? 'pointer' : 'default', textAlign: 'left', font: 'inherit' }}
          title={issue.itemIds[0] ? 'Seleziona il primo prodotto coinvolto' : undefined}
        >
          {issue.message}
        </button>
      ))}
      {issues.length > 3 && <div style={{ color: 'var(--cfg-text-subtle)', marginTop: 2 }}>+{issues.length - 3} altri</div>}
    </div>
  )
}

function Hints() {
  const gizmoMode = useConfiguratorStore((s) => s.gizmoMode)
  const setGizmoMode = useConfiguratorStore((s) => s.setGizmoMode)
  // Subscribe to lengths, not the arrays themselves, so Hints doesn't re-render
  // when undo/redo stacks mutate by reference but their lengths stay the same.
  const pastLen = useConfiguratorStore((s) => s.past.length)
  const futureLen = useConfiguratorStore((s) => s.future.length)
  const undo = useConfiguratorStore((s) => s.undo)
  const redo = useConfiguratorStore((s) => s.redo)
  const readOnly = useConfiguratorStore((s) => s.readOnly)
  const canUndo = !readOnly && pastLen > 0
  const canRedo = !readOnly && futureLen > 0
  return (
    <div style={hintsStyle}>
      <button type="button" disabled={readOnly} onClick={() => setGizmoMode('translate')} title="Sposta (T)" style={{ ...presetBtn, color: gizmoMode === 'translate' ? 'var(--cfg-accent)' : 'var(--cfg-text-muted)', background: gizmoMode === 'translate' ? 'var(--cfg-accent-soft)' : 'transparent', borderColor: 'transparent' }}>Sposta</button>
      <button type="button" disabled={readOnly} onClick={() => setGizmoMode('rotate')} title="Ruota (R)" style={{ ...presetBtn, color: gizmoMode === 'rotate' ? 'var(--cfg-accent)' : 'var(--cfg-text-muted)', background: gizmoMode === 'rotate' ? 'var(--cfg-accent-soft)' : 'transparent', borderColor: 'transparent' }}>Ruota</button>
      <span style={{ width: 1, height: 18, background: 'var(--cfg-line)', margin: '0 4px' }} />
      <button type="button" disabled={!canUndo} onClick={undo} aria-label="Annulla modifica" title="Annulla (Cmd/Ctrl+Z)" style={iconBtn(canUndo)}><Icon name="undo" size={16} /></button>
      <button type="button" disabled={!canRedo} onClick={redo} aria-label="Ripeti modifica" title="Ripeti (Cmd/Ctrl+Shift+Z)" style={iconBtn(canRedo)}><Icon name="redo" size={16} /></button>
    </div>
  )
}

function ViewControls() {
  const setCameraPreset = useConfiguratorStore((s) => s.setCameraPreset)
  const requestFocusSelected = useConfiguratorStore((s) => s.requestFocusSelected)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const xrayEnabled = useConfiguratorStore((s) => s.xrayEnabled)
  const setXray = useConfiguratorStore((s) => s.setXrayEnabled)
  const snapToGridEnabled = useConfiguratorStore((s) => s.snapToGridEnabled)
  const setGrid = useConfiguratorStore((s) => s.setSnapToGridEnabled)
  const gridStep = useConfiguratorStore((s) => s.gridStep)
  const setGridStep = useConfiguratorStore((s) => s.setGridStep)
  const walkMode = useConfiguratorStore((s) => s.walkMode)
  const setWalkMode = useConfiguratorStore((s) => s.setWalkMode)
  const bbox = useConfiguratorStore((s) => s.enclosureBBox)
  const doorsOpen = useConfiguratorStore((s) => s.doorsOpen)
  const setDoorsOpen = useConfiguratorStore((s) => s.setDoorsOpen)

  return (
    <div className="cfg-view-controls" style={viewControlsStyle}>
      <div style={viewRowStyle}>
        <span style={viewLabelStyle}>vista</span>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('top')} title="Vista dall'alto">Alto</button>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('front')} title="Vista frontale">Fronte</button>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('side')} title="Vista laterale">Lato</button>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('iso')} title="Vista isometrica">3D</button>
        <button
          type="button"
          style={presetBtn}
          aria-label="Centra componente"
          disabled={!selectedId || walkMode}
          onClick={requestFocusSelected}
          title={
            selectedId
              ? 'Centra la vista sul pezzo selezionato (F)'
              : 'Seleziona un pezzo per centrarlo'
          }
        >
          <Icon name="focus" size={14} />
        </button>
        <button
          type="button"
          style={{ ...presetBtn, background: walkMode ? 'var(--cfg-primary)' : presetBtn.background, color: walkMode ? 'var(--cfg-on-primary)' : presetBtn.color }}
          disabled={!bbox}
          onClick={() => setWalkMode(!walkMode)}
          title="POV camminata dentro il furgone (clicca canvas per attivare mouse-look, Esc per uscire)"
        >
          Interno
        </button>
        <button
          type="button"
          style={{ ...presetBtn, background: doorsOpen ? 'var(--cfg-primary)' : presetBtn.background, color: doorsOpen ? 'var(--cfg-on-primary)' : presetBtn.color }}
          onClick={() => setDoorsOpen(!doorsOpen)}
          title="Apri/chiudi le porte del furgone"
        >
          {doorsOpen ? 'Chiudi' : 'Apri'}
        </button>
      </div>
      <div style={viewRowStyle}>
        <label style={toggleLabel}>
          <input
            type="checkbox"
            checked={xrayEnabled}
            onChange={(e) => setXray(e.target.checked)}
          />
          X-ray
        </label>
        <label style={toggleLabel}>
          <input
            type="checkbox"
            checked={snapToGridEnabled}
            onChange={(e) => setGrid(e.target.checked)}
          />
          Griglia
        </label>
        {snapToGridEnabled && (
          <select
            value={gridStep}
            onChange={(e) => setGridStep(parseFloat(e.target.value))}
            style={selectStyle}
            title="Passo griglia"
          >
            <option value={0.01}>1 cm</option>
            <option value={0.025}>2.5 cm</option>
            <option value={0.05}>5 cm</option>
            <option value={0.1}>10 cm</option>
          </select>
        )}
      </div>
    </div>
  )
}

function WalkHint() {
  const walkMode = useConfiguratorStore((s) => s.walkMode)
  if (!walkMode) return null
  return (
    <div style={walkHintStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>POV camminata attivo</div>
      <div>Click sulla scena → mouse-look · <b>WASD</b>/frecce muovi · <b>Shift</b> corri · <b>Esc</b> esci</div>
    </div>
  )
}

function ClearanceOverlay() {
  const c = useConfiguratorStore((s) => s.dragClearance)
  if (!c) return null
  const fmt = (v: number) => {
    const cm = v * 100
    const color = cm < 0 ? 'var(--cfg-error)' : cm < 2 ? 'var(--cfg-warning)' : 'var(--cfg-text-muted)'
    return <span style={{ color, fontFamily: 'monospace' }}>{cm.toFixed(1)} cm</span>
  }
  return (
    <div style={clearanceStyle}>
      <div style={{ color: 'var(--cfg-text-subtle)', marginBottom: 4 }}>Distanza pareti</div>
      <div style={clearanceRow}><span style={clearanceLabel}>sx</span>{fmt(c.left)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>dx</span>{fmt(c.right)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>avanti</span>{fmt(c.front)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>dietro</span>{fmt(c.back)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>sopra</span>{fmt(c.top)}</div>
      <div style={clearanceRow}><span style={clearanceLabel}>sotto</span>{fmt(c.bottom)}</div>
    </div>
  )
}

function CatalogStatusBadge({ text, tone }: { text: string; tone: 'info' | 'error' }) {
  return (
    <div
      style={{
        ...badgeStyle,
        background: tone === 'error' ? 'var(--cfg-error-surface)' : 'var(--cfg-surface)',
        color: tone === 'error' ? 'var(--cfg-error)' : 'var(--cfg-text-muted)',
        border: `1px solid ${tone === 'error' ? 'var(--cfg-error-line)' : 'var(--cfg-line)'}`,
      }}
    >
      {text}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles — hoisted out of render so identity is stable across re-renders.
// ---------------------------------------------------------------------------

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  zIndex: 22,
}
const hintsStyle: React.CSSProperties = {
  position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 2,
  alignItems: 'center', padding: 5, background: 'var(--cfg-surface)',
  border: '1px solid var(--cfg-line)', borderRadius: 8, fontSize: 11,
}
const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  right: 12,
  padding: '6px 10px',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  maxWidth: 320,
}

const iconBtn = (enabled: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  background: 'transparent', color: enabled ? 'var(--cfg-text-secondary)' : '#94a3b8', border: 0,
  borderRadius: 7, cursor: enabled ? 'pointer' : 'not-allowed',
})
const viewControlsStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 6,
  background: 'var(--cfg-surface)',
  color: 'var(--cfg-text-secondary)',
  border: '1px solid var(--cfg-line)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
}
const viewRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}
const viewLabelStyle: React.CSSProperties = {
  color: 'var(--cfg-text-subtle)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginRight: 4,
}
const presetBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--cfg-surface-muted)', color: 'var(--cfg-text-secondary)', border: '1px solid var(--cfg-line)',
  borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 11, minHeight: 30,
}
const toggleLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  cursor: 'pointer',
  color: 'var(--cfg-text-muted)',
  fontSize: 11,
}
const selectStyle: React.CSSProperties = {
  background: 'var(--cfg-surface)',
  color: 'var(--cfg-text-secondary)',
  border: '1px solid var(--cfg-line)',
  borderRadius: 3,
  padding: '1px 4px',
  fontFamily: 'monospace',
  fontSize: 10,
}
const clearanceStyle: React.CSSProperties = {
  position: 'absolute',
  top: 80,
  left: 12,
  padding: '6px 10px',
  background: 'var(--cfg-surface)',
  border: '1px solid var(--cfg-line)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: 'var(--cfg-text-secondary)',
  minWidth: 140,
}
const inspectorColumnStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 12,
  maxHeight: 'calc(100% - 96px)',
  maxWidth: 'calc(100% - 24px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 8,
  pointerEvents: 'none',
}
const validationStyle: React.CSSProperties = {
  maxWidth: 320,
  flexShrink: 0,
  pointerEvents: 'auto',
  padding: '10px 12px',
  background: 'var(--cfg-surface)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
}
const clearanceRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '1px 0',
}
const clearanceLabel: React.CSSProperties = {
  color: 'var(--cfg-text-subtle)',
  fontSize: 10,
}
const walkHintStyle: React.CSSProperties = {
  position: 'absolute',
  top: 60,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  background: 'var(--cfg-surface)',
  border: '1px solid var(--cfg-accent)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: 'var(--cfg-text-secondary)',
  pointerEvents: 'none',
  textAlign: 'center',
}
