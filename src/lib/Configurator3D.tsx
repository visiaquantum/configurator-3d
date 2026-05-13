import { useEffect, useState } from 'react'
import { Scene } from './scene/Scene'
import { CatalogPanel } from './ui/CatalogPanel'
import { Inspector } from './ui/Inspector'
import { useConfiguratorStore } from './state/store'
import { loadCatalog } from './io/catalog'
import {
  captureCanvasImage,
  downloadBlob,
  exportProjectPDF,
  exportSceneGLB,
} from './io/export'
import type { CatalogItem, Configurator3DProps } from './types'

export function Configurator3D({
  initialProject,
  catalog = [],
  onChange,
  onSave,
  onCatalogLoaded,
  onCatalogError,
  readOnly,
  className,
  style,
}: Configurator3DProps) {
  const setProject = useConfiguratorStore((s) => s.setProject)
  const project = useConfiguratorStore((s) => s.project)

  // Resolve catalog: inline array passes through; URL string is fetched + validated.
  // Fetch result is keyed by URL so loading/error state derives from "fetched.url !== current url"
  // — this keeps all setState calls inside async callbacks (no cascading-render warnings).
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

  const resolvedCatalog: CatalogItem[] = Array.isArray(catalog)
    ? catalog
    : fetched && fetched.url === catalogUrl && 'items' in fetched
      ? fetched.items
      : []

  const catalogStatus: { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string } =
    Array.isArray(catalog)
      ? { state: 'idle' }
      : !fetched || fetched.url !== catalogUrl
        ? { state: 'loading' }
        : 'error' in fetched
          ? { state: 'error', message: fetched.error }
          : { state: 'idle' }

  useEffect(() => {
    setProject(initialProject)
  }, [initialProject, setProject])

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

  if (!project) return null

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', ...style }}
    >
      <Scene project={project} catalog={resolvedCatalog} />
      <CatalogPanel catalog={resolvedCatalog} readOnly={readOnly} />
      <Inspector catalog={resolvedCatalog} readOnly={readOnly} />
      <Hints />
      {catalogStatus.state === 'loading' && <CatalogStatusBadge text="Caricamento catalogo…" tone="info" />}
      {catalogStatus.state === 'error' && (
        <CatalogStatusBadge text={`Catalogo: ${catalogStatus.message}`} tone="error" />
      )}
      <Toolbar
        readOnly={readOnly}
        onSave={onSave}
        project={project}
        catalog={resolvedCatalog}
      />
    </div>
  )
}

function Toolbar({
  readOnly,
  onSave,
  project,
  catalog,
}: {
  readOnly?: boolean
  onSave?: (p: Configurator3DProps['initialProject']) => void
  project: Configurator3DProps['initialProject']
  catalog: CatalogItem[]
}) {
  const handleExportImage = () => {
    const s = useConfiguratorStore.getState()
    s.select(null)
    requestAnimationFrame(() => {
      const refs = useConfiguratorStore.getState().captureRefs
      if (!refs) return
      const dataUrl = captureCanvasImage(refs.gl, refs.scene, refs.camera)
      // dataURL → Blob
      fetch(dataUrl)
        .then((r) => r.blob())
        .then((blob) => downloadBlob(blob, `${project.id || 'scene'}.png`))
    })
  }

  const handleExportGLB = () => {
    const s = useConfiguratorStore.getState()
    s.select(null)
    requestAnimationFrame(async () => {
      const roots = useConfiguratorStore.getState().collectExportRoots()
      if (roots.length === 0) return
      const blob = await exportSceneGLB(roots)
      downloadBlob(blob, `${project.id || 'scene'}.glb`)
    })
  }

  const handleExportPDF = () => {
    const s = useConfiguratorStore.getState()
    s.select(null)
    requestAnimationFrame(() => {
      const refs = useConfiguratorStore.getState().captureRefs
      const imageDataUrl = refs ? captureCanvasImage(refs.gl, refs.scene, refs.camera, 'image/jpeg') : undefined
      const current = useConfiguratorStore.getState().project ?? project
      const blob = exportProjectPDF({ project: current, catalog, imageDataUrl })
      downloadBlob(blob, `${project.id || 'project'}.pdf`)
    })
  }

  return (
    <div style={toolbarStyle}>
      {onSave && (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            const current = useConfiguratorStore.getState().project ?? project
            onSave(current)
          }}
          style={primaryBtn}
        >
          Salva
        </button>
      )}
      <button type="button" onClick={handleExportImage} style={secondaryBtn} title="Esporta immagine PNG">
        PNG
      </button>
      <button type="button" onClick={handleExportGLB} style={secondaryBtn} title="Esporta scena GLB">
        GLB
      </button>
      <button type="button" onClick={handleExportPDF} style={secondaryBtn} title="Esporta PDF con lista componenti">
        PDF
      </button>
    </div>
  )
}

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
      <button
        type="button"
        disabled={!canUndo}
        onClick={undo}
        title="Cmd/Ctrl+Z"
        style={iconBtn(canUndo)}
      >
        ↶ {pastLen}
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={redo}
        title="Cmd/Ctrl+Shift+Z"
        style={iconBtn(canRedo)}
      >
        ↷ {futureLen}
      </button>
    </div>
  )
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

function CatalogStatusBadge({ text, tone }: { text: string; tone: 'info' | 'error' }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        padding: '6px 10px',
        background: tone === 'error' ? 'rgba(60,20,20,0.92)' : 'rgba(15,15,20,0.85)',
        color: tone === 'error' ? '#ff9090' : '#9aa',
        border: `1px solid ${tone === 'error' ? '#d04040' : '#2a2a35'}`,
        borderRadius: 6,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        maxWidth: 320,
      }}
    >
      {text}
    </div>
  )
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
