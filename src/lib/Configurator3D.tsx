import { useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useGLTF } from '@react-three/drei'
import { Scene } from './scene/Scene'
import { Inspector } from './ui/Inspector'
import { useConfiguratorStore } from './state/store'
import { loadCatalog } from './io/catalog'
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
  Vec3,
} from './types'

export function Configurator3D({
  ref,
  enclosure,
  initialItems,
  projectId,
  metadata,
  catalog,
  onChange,
  onSave,
  onCatalogLoaded,
  onCatalogError,
  showInspector = true,
  showToolbar = true,
  showHints = true,
  readOnly,
  className,
  style,
}: Configurator3DProps) {
  const setProject = useConfiguratorStore((s) => s.setProject)
  const setCatalog = useConfiguratorStore((s) => s.setCatalog)
  const setReadOnly = useConfiguratorStore((s) => s.setReadOnly)
  const project = useConfiguratorStore((s) => s.project)

  // Build the project once when any of the source props change (reference compare).
  // Host should memoize these to control when the scene resets.
  const builtProject = useMemo<ProjectData>(() => {
    const enclosureData: EnclosureData =
      typeof enclosure === 'string' ? { glbUrl: enclosure } : enclosure
    return {
      id: projectId ?? `cfg-${nanoid(8)}`,
      version: PROJECT_SCHEMA_VERSION,
      enclosure: enclosureData,
      items: initialItems ?? [],
      metadata,
    }
  }, [enclosure, initialItems, projectId, metadata])

  // Resolve catalog: inline array passes through; URL string is fetched + validated.
  const catalogUrl = typeof catalog === 'string' ? catalog : null
  const [fetched, setFetched] = useState<
    { url: string; items: CatalogItem[] } | { url: string; error: string } | null
  >(null)

  useEffect(() => {
    if (!catalogUrl) return
    let cancelled = false
    loadCatalog(catalogUrl)
      .then((items) => {
        if (cancelled) return
        setFetched({ url: catalogUrl, items })
        onCatalogLoaded?.(items)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setFetched({ url: catalogUrl, error: e.message })
        onCatalogError?.(e)
      })
    return () => {
      cancelled = true
    }
  }, [catalogUrl, onCatalogLoaded, onCatalogError])

  // Push prop catalog into the store. Imperative `addItem` adds more on top.
  // Also preload each catalog GLB so the first instance of a new type doesn't
  // suspend its Suspense boundary (which would briefly blank the item).
  useEffect(() => {
    if (Array.isArray(catalog)) {
      setCatalog(catalog)
      catalog.forEach((c) => useGLTF.preload(c.glbUrl))
      return
    }
    if (fetched && fetched.url === catalogUrl && 'items' in fetched) {
      setCatalog(fetched.items)
      fetched.items.forEach((c) => useGLTF.preload(c.glbUrl))
    }
  }, [catalog, fetched, catalogUrl, setCatalog])

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
    if (project && onChange) onChange(project)
  }, [project, onChange])

  // Global keyboard shortcuts
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const s = useConfiguratorStore.getState()
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) {
        s.removeItem(s.selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly])

  // Imperative API exposed to host via ref.
  useImperativeHandle(
    ref,
    (): ConfiguratorHandle => ({
      addItem(product, opts) {
        return addItemToScene(product, opts)
      },
      removeItem(id) {
        useConfiguratorStore.getState().removeItem(id)
      },
      selectItem(id) {
        useConfiguratorStore.getState().select(id)
      },
      getProject() {
        return useConfiguratorStore.getState().project
      },
      setProject(p) {
        useConfiguratorStore.getState().setProject(p)
      },
      undo() {
        useConfiguratorStore.getState().undo()
      },
      redo() {
        useConfiguratorStore.getState().redo()
      },
      exportPNG: () => exportSceneAsBlob('png'),
      exportGLB: () => exportSceneAsBlob('glb'),
      exportPDF: () => exportSceneAsBlob('pdf'),
    }),
    [],
  )

  if (!project) return null

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', ...style }}
    >
      <Scene project={project} />
      {showInspector && <Inspector readOnly={readOnly} />}
      {showHints && <Hints />}
      <ViewControls />
      <EnclosureInfo />
      <ClearanceOverlay />
      <WalkHint />
      {catalogStatus.state === 'loading' && (
        <CatalogStatusBadge text="Caricamento catalogo…" tone="info" />
      )}
      {catalogStatus.state === 'error' && (
        <CatalogStatusBadge text={`Catalogo: ${catalogStatus.message}`} tone="error" />
      )}
      {showToolbar && <Toolbar readOnly={readOnly} onSave={onSave} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Imperative helpers — read/write store from anywhere. The component's ref
// API delegates to these; they're also used by the built-in Toolbar.
// ---------------------------------------------------------------------------

function addItemToScene(
  product: CatalogItem,
  opts?: { position?: Vec3; select?: boolean },
): string {
  const s = useConfiguratorStore.getState()
  if (!s.catalog[product.id]) useGLTF.preload(product.glbUrl)
  s.addCatalogItem(product)
  const items = s.project?.items ?? []
  const last = items[items.length - 1]
  const lastCat = last ? s.catalog[last.catalogId] : undefined
  const gap = 0.05
  const lastScale = lastCat?.scale ?? 1
  const nextScale = product.scale ?? 1
  const stepSize = (lastCat?.size?.[0] ?? 0.1) * lastScale || (product.size?.[0] ?? 0.1) * nextScale
  const position: Vec3 =
    opts?.position ??
    (last
      ? [last.position[0] + stepSize + gap, last.position[1], last.position[2]]
      : [0, 0, 0])
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

async function exportSceneAsBlob(kind: 'png' | 'glb' | 'pdf'): Promise<Blob> {
  // Deselect, then wait two frames: one for React to commit the unmount of
  // TransformControls/wireframe, one for R3F to render the clean scene.
  useConfiguratorStore.getState().select(null)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const s = useConfiguratorStore.getState()
  const refs = s.captureRefs
  if (kind === 'png') {
    if (!refs) throw new Error('Scene not ready')
    const dataUrl = captureCanvasImage(refs.gl, refs.scene, refs.camera)
    return await (await fetch(dataUrl)).blob()
  }
  if (kind === 'glb') {
    const roots = s.collectExportRoots()
    if (roots.length === 0) throw new Error('No exportable geometry')
    return exportSceneGLB(roots)
  }
  // pdf
  const imageDataUrl = refs
    ? captureCanvasImage(refs.gl, refs.scene, refs.camera, 'image/jpeg')
    : undefined
  const project = s.project
  if (!project) throw new Error('No project')
  return exportProjectPDF({
    project,
    catalog: Object.values(s.catalog),
    imageDataUrl,
  })
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
  const projectId = useConfiguratorStore((s) => s.project?.id ?? 'scene')
  const download = async (kind: 'png' | 'glb' | 'pdf') => {
    const blob = await exportSceneAsBlob(kind)
    const ext = kind === 'glb' ? 'glb' : kind === 'pdf' ? 'pdf' : 'png'
    downloadBlob(blob, `${projectId}.${ext}`)
  }

  return (
    <div style={toolbarStyle}>
      {onSave && (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            const current = useConfiguratorStore.getState().project
            if (current) onSave(current)
          }}
          style={primaryBtn}
        >
          Salva
        </button>
      )}
      <button type="button" onClick={() => download('png')} style={secondaryBtn} title="Esporta immagine PNG">
        PNG
      </button>
      <button type="button" onClick={() => download('glb')} style={secondaryBtn} title="Esporta scena GLB">
        GLB
      </button>
      <button type="button" onClick={() => download('pdf')} style={secondaryBtn} title="Esporta PDF con lista componenti">
        PDF
      </button>
    </div>
  )
}

function Hints() {
  const gizmoMode = useConfiguratorStore((s) => s.gizmoMode)
  // Subscribe to lengths, not the arrays themselves, so Hints doesn't re-render
  // when undo/redo stacks mutate by reference but their lengths stay the same.
  const pastLen = useConfiguratorStore((s) => s.past.length)
  const futureLen = useConfiguratorStore((s) => s.future.length)
  const undo = useConfiguratorStore((s) => s.undo)
  const redo = useConfiguratorStore((s) => s.redo)
  const canUndo = pastLen > 0
  const canRedo = futureLen > 0
  return (
    <div style={hintsStyle}>
      <span style={{ pointerEvents: 'none' }}>
        gizmo: <b style={{ color: gizmoMode === 'translate' ? '#3aa0ff' : '#666' }}>T</b> /{' '}
        <b style={{ color: gizmoMode === 'rotate' ? '#3aa0ff' : '#666' }}>R</b>
      </span>
      <button type="button" disabled={!canUndo} onClick={undo} title="Cmd/Ctrl+Z" style={iconBtn(canUndo)}>
        ↶ {pastLen}
      </button>
      <button type="button" disabled={!canRedo} onClick={redo} title="Cmd/Ctrl+Shift+Z" style={iconBtn(canRedo)}>
        ↷ {futureLen}
      </button>
    </div>
  )
}

function ViewControls() {
  const setCameraPreset = useConfiguratorStore((s) => s.setCameraPreset)
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
    <div style={viewControlsStyle}>
      <div style={viewRowStyle}>
        <span style={viewLabelStyle}>vista</span>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('top')} title="Vista dall'alto">⤓</button>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('front')} title="Vista frontale">F</button>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('side')} title="Vista laterale">S</button>
        <button type="button" style={presetBtn} onClick={() => setCameraPreset('iso')} title="Vista isometrica">◆</button>
        <button
          type="button"
          style={{ ...presetBtn, background: walkMode ? '#3aa0ff' : presetBtn.background, color: walkMode ? '#fff' : presetBtn.color }}
          disabled={!bbox}
          onClick={() => setWalkMode(!walkMode)}
          title="POV camminata dentro il furgone (clicca canvas per attivare mouse-look, Esc per uscire)"
        >
          Walk
        </button>
        <button
          type="button"
          style={{ ...presetBtn, background: doorsOpen ? '#3aa0ff' : presetBtn.background, color: doorsOpen ? '#fff' : presetBtn.color }}
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
          Grid
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

function EnclosureInfo() {
  const bbox = useConfiguratorStore((s) => s.enclosureBBox)
  const interior = useConfiguratorStore((s) => s.interiorBBox)
  const itemCount = useConfiguratorStore((s) => s.project?.items.length ?? 0)
  if (!bbox) return null
  // X = larghezza, Y = altezza, Z = lunghezza (van faces -Z by convention).
  const wM = bbox.max[0] - bbox.min[0]
  const hM = bbox.max[1] - bbox.min[1]
  const lM = bbox.max[2] - bbox.min[2]
  const volumeM3 = wM * hM * lM
  const iwM = interior ? interior.max[0] - interior.min[0] : null
  const ihM = interior ? interior.max[1] - interior.min[1] : null
  const ilM = interior ? interior.max[2] - interior.min[2] : null
  const iVolM3 = interior && iwM != null && ihM != null && ilM != null ? iwM * ihM * ilM : null
  // Dual-unit formatter: ≥1 m → metri con 2 decimali; altrimenti cm.
  const fmt = (m: number) =>
    m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(0)} cm`
  return (
    <div style={infoStyle}>
      <span style={infoTitle}>Furgone</span>
      <div style={infoMetric}>
        <span style={infoLabel}>Lungh.</span>
        <span style={infoValue}>{fmt(lM)}</span>
      </div>
      <div style={infoMetric}>
        <span style={infoLabel}>Largh.</span>
        <span style={infoValue}>{fmt(wM)}</span>
      </div>
      <div style={infoMetric}>
        <span style={infoLabel}>Alt.</span>
        <span style={infoValue}>{fmt(hM)}</span>
      </div>
      <span style={infoDivider} />
      <div style={infoMetric}>
        <span style={infoLabel}>Volume</span>
        <span style={infoValue}>
          {volumeM3 >= 1 ? `${volumeM3.toFixed(2)} m³` : `${(volumeM3 * 1000).toFixed(0)} L`}
        </span>
      </div>
      <div style={infoMetric}>
        <span style={infoLabel}>Componenti</span>
        <span style={infoValue}>{itemCount}</span>
      </div>
      {interior && iwM != null && ihM != null && ilM != null && iVolM3 != null && (
        <>
          <span style={infoDivider} />
          <span style={infoTitle}>Vano interno</span>
          <div style={infoMetric}>
            <span style={infoLabel}>L × W × H</span>
            <span style={infoValue}>
              {fmt(ilM)} × {fmt(iwM)} × {fmt(ihM)}
            </span>
          </div>
          <div style={infoMetric}>
            <span style={infoLabel}>Volume</span>
            <span style={infoValue}>
              {iVolM3 >= 1 ? `${iVolM3.toFixed(2)} m³` : `${(iVolM3 * 1000).toFixed(0)} L`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function ClearanceOverlay() {
  const c = useConfiguratorStore((s) => s.dragClearance)
  if (!c) return null
  const fmt = (v: number) => {
    const cm = v * 100
    const color = cm < 0 ? '#ff6060' : cm < 2 ? '#ffaa33' : '#9aa'
    return <span style={{ color, fontFamily: 'monospace' }}>{cm.toFixed(1)} cm</span>
  }
  return (
    <div style={clearanceStyle}>
      <div style={{ color: '#778', marginBottom: 4 }}>Distanza pareti</div>
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
        background: tone === 'error' ? 'rgba(60,20,20,0.92)' : 'rgba(15,15,20,0.85)',
        color: tone === 'error' ? '#ff9090' : '#9aa',
        border: `1px solid ${tone === 'error' ? '#d04040' : '#2a2a35'}`,
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
  top: 12,
  right: 12,
  display: 'flex',
  gap: 6,
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: '#3aa0ff',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
}
const secondaryBtn: React.CSSProperties = {
  padding: '8px 12px',
  background: '#2a2a35',
  color: '#ddd',
  border: '1px solid #3a3a45',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
}
const hintsStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '6px 10px',
  background: 'rgba(15,15,20,0.85)',
  color: '#9aa',
  border: '1px solid #2a2a35',
  borderRadius: 6,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
}
const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  right: 12,
  padding: '6px 10px',
  borderRadius: 6,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  maxWidth: 320,
}

const iconBtn = (enabled: boolean): React.CSSProperties => ({
  background: enabled ? '#2a2a35' : 'transparent',
  color: enabled ? '#ddd' : '#555',
  border: '1px solid #2a2a35',
  borderRadius: 4,
  padding: '2px 8px',
  fontSize: 12,
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontFamily: 'monospace',
})

const viewControlsStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 6,
  background: 'rgba(15,15,20,0.85)',
  color: '#ddd',
  border: '1px solid #2a2a35',
  borderRadius: 6,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
}
const viewRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}
const viewLabelStyle: React.CSSProperties = {
  color: '#778',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginRight: 4,
}
const presetBtn: React.CSSProperties = {
  background: '#2a2a35',
  color: '#ddd',
  border: '1px solid #3a3a45',
  borderRadius: 3,
  padding: '2px 8px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 12,
  minWidth: 24,
}
const toggleLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  cursor: 'pointer',
  color: '#bbb',
  fontSize: 11,
}
const selectStyle: React.CSSProperties = {
  background: '#1a1a25',
  color: '#ddd',
  border: '1px solid #2a2a35',
  borderRadius: 3,
  padding: '1px 4px',
  fontFamily: 'monospace',
  fontSize: 10,
}
const infoStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '6px 14px',
  background: 'rgba(15,15,20,0.9)',
  border: '1px solid #2a2a35',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: '#ddd',
  backdropFilter: 'blur(6px)',
}
const infoTitle: React.CSSProperties = {
  color: '#9aa',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  paddingRight: 8,
  borderRight: '1px solid #2a2a35',
}
const infoMetric: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  lineHeight: 1.1,
}
const infoLabel: React.CSSProperties = {
  color: '#778',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
}
const infoValue: React.CSSProperties = {
  color: '#ddd',
  fontSize: 12,
  fontFamily: 'monospace',
  fontWeight: 600,
  marginTop: 1,
}
const infoDivider: React.CSSProperties = {
  width: 1,
  height: 22,
  background: '#2a2a35',
}
const clearanceStyle: React.CSSProperties = {
  position: 'absolute',
  top: 80,
  left: 12,
  padding: '6px 10px',
  background: 'rgba(15,15,20,0.9)',
  border: '1px solid #2a2a35',
  borderRadius: 6,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: '#ddd',
  minWidth: 140,
}
const clearanceRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '1px 0',
}
const clearanceLabel: React.CSSProperties = {
  color: '#778',
  fontSize: 10,
}
const walkHintStyle: React.CSSProperties = {
  position: 'absolute',
  top: 60,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  background: 'rgba(15,15,20,0.92)',
  border: '1px solid #3aa0ff',
  borderRadius: 6,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: '#ddd',
  pointerEvents: 'none',
  textAlign: 'center',
}
