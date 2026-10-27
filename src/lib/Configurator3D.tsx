import { useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { Scene } from './scene/Scene'
import { Inspector } from './ui/Inspector'
import { AttachmentOverlay } from './ui/AttachmentOverlay'
import { Toolbar } from './ui/Toolbar'
import { ValidationPanel } from './ui/ValidationPanel'
import { CatalogStatusBadge, ClearanceOverlay, Hints, ViewControls, WalkHint } from './ui/ViewControls'
import { configuratorStyles } from './ui/styles'
import { ConfiguratorStoreContext, createConfiguratorStore, useConfiguratorStore, useConfiguratorStoreApi } from './state/store'
import { ConfiguratorStoreProvider } from './state/ConfiguratorStoreProvider'
import { validationForState } from './state/readiness'
import { shortcutFor } from './state/shortcuts'
import { useValidationReport } from './state/useValidationReport'
import { loadCatalog } from './io/catalog'
import { loadAssemblyManifest } from './assembly/manifest'
import { exportSceneAsBlob } from './io/sceneExport'
import { addItemToScene } from './scene/commands'
import { PROJECT_SCHEMA_VERSION } from './types'
import type { Configurator3DProps, ConfiguratorHandle, EnclosureData, ProjectData } from './types'

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
  const validationIssues = useConfiguratorStore((s) => s.validationIssues)
  const loadingCatalog = useConfiguratorStore((s) => s.loadingCatalog)
  const catalogError = useConfiguratorStore((s) => s.catalogError)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    if (attachmentStage && attachmentStage !== 'menu') containerRef.current?.focus({ preventScroll: true })
  }, [attachmentStage])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useValidationReport(storeApi, onValidationChange)

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
      // Models load on demand. Preloading the entire catalog can exhaust memory
      // and puts failures outside the per-model error boundary.
      storeApi.getState().reportTelemetry({ type: 'catalog-load', outcome: 'success', durationMs: performance.now() - startedAt, detail: { itemCount: items.length } })
      catalogCallbacks.current.onCatalogLoaded?.(items)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      const error = cause instanceof Error ? cause : new Error(String(cause))
      storeApi.setState({ loadingCatalog: false, catalogError: error.message })
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


  useEffect(() => {
    setReadOnly(!!readOnly)
  }, [readOnly, setReadOnly])

  useEffect(() => {
    setProject(builtProject)
  }, [builtProject, setProject])

  useEffect(() => {
    const persisted = storeApi.getState().exportProject()
    if (persisted) onChangeRef.current?.(persisted)
  }, [project, storeApi])

  // Global keyboard shortcuts
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return
      if ((e.target as HTMLElement | null)?.isContentEditable) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const shortcut = shortcutFor(e, storeApi.getState())
      if (!shortcut) return
      if (shortcut.preventDefault) e.preventDefault()
      shortcut.run(storeApi.getState())
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
      {catalogUrl && loadingCatalog && (
        <CatalogStatusBadge text="Caricamento catalogo…" tone="info" />
      )}
      {catalogError && (
        <CatalogStatusBadge text={`Catalogo: ${catalogError}`} tone="error" />
      )}
      {assemblyManifest && manifestError && (
        <CatalogStatusBadge text={`Manifest: ${manifestError}`} tone="error" />
      )}
      {showToolbar && <Toolbar readOnly={readOnly} onSave={onSave} />}
      {!attachment && !project.items.length && <div className="cfg-empty-hint">Aggiungi un componente dal catalogo per iniziare</div>}
    </div>
  )
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
