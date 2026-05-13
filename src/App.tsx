import { useRef, useState } from 'react'
import {
  Configurator3D,
  parseProject,
  serializeProject,
  ProjectParseError,
  useConfiguratorStore,
} from './lib'
import type { CatalogItem, ProjectData, ProjectIssue } from './lib'

const catalog: CatalogItem[] = [
  { id: 'ksi44036', label: 'KSI 44036', glbUrl: '/models/A-KSI44036.glb', size: [0.101, 0.036, 0.144] },
  { id: 'kdw40236', label: 'KDW 40236', glbUrl: '/models/KDW40236.glb', size: [0.100, 0.036, 0.007] },
  { id: 'ptbm31sx', label: 'PTBM 31SX', glbUrl: '/models/PTBM31SX.glb', size: [0.009, 0.031, 0.014] },
  { id: 'xds40536', label: 'XDS 40536 KMD02', glbUrl: '/models/XDS40536KMD02.glb', size: [0.101, 0.036, 0.018] },
]

const initialProject: ProjectData = {
  id: 'demo-008',
  version: 1,
  // Anchors now embedded in the enclosure GLB itself as `anchor_*` nodes.
  // The library extracts them at runtime; no need to declare them here.
  enclosure: { glbUrl: '/models/FIAT-NDC40H2.glb' },
  items: [
    { id: 'i1', catalogId: 'ksi44036', position: [-0.05, 0, 0], rotation: [0, 0, 0] },
    { id: 'i2', catalogId: 'kdw40236', position: [0.0, 0, 0], rotation: [0, 0, 0] },
    { id: 'i3', catalogId: 'xds40536', position: [0.05, 0, 0], rotation: [0, 0, 0] },
    { id: 'i4', catalogId: 'ptbm31sx', position: [0.1, 0, 0], rotation: [0, 0, 0] },
  ],
  metadata: { name: 'Demo M8 — serialize', customer: 'Proarredi' },
}

export default function App() {
  const [savedJson, setSavedJson] = useState('')
  const [loadStatus, setLoadStatus] = useState<{ ok: boolean; msg: string; issues?: ProjectIssue[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    const project = useConfiguratorStore.getState().project
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
          initialProject={initialProject}
          catalog={catalog}
          onSave={(p) => setSavedJson(serializeProject(p))}
        />
      </div>
      <aside
        style={{
          width: 360,
          padding: 16,
          background: '#0f0f14',
          color: '#ddd',
          fontFamily: 'monospace',
          fontSize: 12,
          overflow: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Configurator3D — M8 (serialize)</h3>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            onClick={handleExport}
            style={{ flex: 1, padding: '6px 10px', background: '#3aa0ff', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            data-testid="export"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{ flex: 1, padding: '6px 10px', background: '#2a2a35', color: '#ddd', border: '1px solid #3a3a45', borderRadius: 4, cursor: 'pointer' }}
            data-testid="import"
          >
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
          {savedJson || '(premi Salva nel canvas)'}
        </pre>
      </aside>
    </div>
  )
}
