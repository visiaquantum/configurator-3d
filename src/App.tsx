import { useRef, useState } from 'react'
import {
  Configurator3D,
  parseProject,
  serializeProject,
  ProjectParseError,
  useConfiguratorStore,
} from './lib'
import type {
  CatalogItem,
  ConfiguratorHandle,
  EnclosureData,
  ProjectIssue,
  ProjectMetadata,
} from './lib'

// Models were exported at 0.1× scale; apply 10× to render at real meters.
const MODEL_SCALE = 10

const catalog: CatalogItem[] = [
  { id: 'ksi44036', label: 'KSI 44036', glbUrl: '/models/A-KSI44036.glb', size: [0.101, 0.036, 0.144], scale: MODEL_SCALE },
  { id: 'kdw40236', label: 'KDW 40236', glbUrl: '/models/KDW40236.glb', size: [0.100, 0.036, 0.007], scale: MODEL_SCALE },
  { id: 'ptbm31sx', label: 'PTBM 31SX', glbUrl: '/models/PTBM31SX.glb', size: [0.009, 0.031, 0.014], scale: MODEL_SCALE },
  { id: 'xds40536', label: 'XDS 40536 KMD02', glbUrl: '/models/XDS40536KMD02.glb', size: [0.101, 0.036, 0.018], scale: MODEL_SCALE },
]

const ENCLOSURE: EnclosureData = {
  glbUrl: '/models/FIAT-NDC40H2.glb',
  scale: MODEL_SCALE,
}
const PROJECT_METADATA: ProjectMetadata = {
  name: 'Demo — host-driven catalog',
  customer: 'Proarredi',
}

export default function App() {
  const cfg = useRef<ConfiguratorHandle>(null)
  const [savedJson, setSavedJson] = useState('')
  const [loadStatus, setLoadStatus] = useState<{ ok: boolean; msg: string; issues?: ProjectIssue[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleAdd = (product: CatalogItem) => {
    cfg.current?.addItem(product)
  }

  const handleExportJson = () => {
    const project = cfg.current?.getProject()
    if (!project) return
    const blob = new Blob([serializeProject(project)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.id || 'project'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const { project, warnings } = parseProject(text, { catalog })
      useConfiguratorStore.getState().setProject(project)
      setLoadStatus({
        ok: true,
        msg: `Caricato "${project.id}" v${project.version} con ${project.items.length} item${warnings.length ? ` (${warnings.length} warning)` : ''}`,
        issues: warnings,
      })
    } catch (e) {
      if (e instanceof ProjectParseError) {
        setLoadStatus({ ok: false, msg: e.message, issues: e.issues })
      } else {
        setLoadStatus({ ok: false, msg: (e as Error).message })
      }
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', margin: 0 }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <Configurator3D
          ref={cfg}
          enclosure={ENCLOSURE}
          projectId="demo-010"
          metadata={PROJECT_METADATA}
          // `catalog` here just seeds the registry. New items come through addItem.
          catalog={catalog}
          onSave={(p) => setSavedJson(serializeProject(p))}
        />
      </div>
      <aside style={sidebarStyle}>
        <h3 style={{ marginTop: 0 }}>Catalogo</h3>
        <p style={{ color: '#778', marginTop: 0, fontSize: 11 }}>
          Click su un prodotto per aggiungerlo alla scena.
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
          {catalog.map((p) => (
            <li key={p.id} style={{ marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => handleAdd(p)}
                style={productBtnStyle}
              >
                <div style={{ fontWeight: 600 }}>{p.label}</div>
                <div style={{ color: '#778', fontSize: 10 }}>{p.id}</div>
              </button>
            </li>
          ))}
        </ul>

        <h3 style={{ marginBottom: 6 }}>Progetto</h3>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button type="button" onClick={handleExportJson} style={ghostBtn}>
            Export JSON
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} style={ghostBtn}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button type="button" onClick={() => cfg.current?.undo()} style={ghostBtn}>
            Undo
          </button>
          <button type="button" onClick={() => cfg.current?.redo()} style={ghostBtn}>
            Redo
          </button>
        </div>

        {loadStatus && (
          <div
            style={{
              padding: 8,
              marginBottom: 10,
              borderRadius: 4,
              background: loadStatus.ok ? '#1a3a25' : '#3a1a1a',
              border: `1px solid ${loadStatus.ok ? '#33ff88' : '#d04040'}`,
              fontSize: 11,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{loadStatus.msg}</div>
            {loadStatus.issues && loadStatus.issues.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {loadStatus.issues.map((i, k) => (
                  <li key={k} style={{ color: i.level === 'error' ? '#ff8888' : '#ffcc66' }}>
                    [{i.level}] {i.path}: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {savedJson || '(premi Salva nel canvas o Export JSON)'}
        </pre>
      </aside>
    </div>
  )
}

const sidebarStyle: React.CSSProperties = {
  width: 320,
  padding: 16,
  background: '#0f0f14',
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  overflow: 'auto',
}
const productBtnStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '8px 10px',
  background: '#1a1a25',
  color: '#ddd',
  border: '1px solid #2a2a35',
  borderRadius: 4,
  cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  background: '#2a2a35',
  color: '#ddd',
  border: '1px solid #3a3a45',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
}
