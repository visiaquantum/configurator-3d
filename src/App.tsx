import { useRef, useState } from 'react'
import {
  Configurator3D,
  parseProject,
  serializeProject,
  ProjectParseError,
  useConfiguratorStore,
} from './lib'
import { definitionFor } from './lib/assembly/manifest'
import type {
  CatalogItem,
  ConfiguratorHandle,
  EnclosureData,
  ProjectIssue,
  ProjectMetadata,
} from './lib'

// Models were exported at 0.1× scale; apply 10× to render at real meters.
const MODEL_SCALE = 10

// Product GLBs under public/models are exported at real meter scale, unlike the
// enclosure which needs MODEL_SCALE. Every `size` below is the visible body
// bbox only (SNAP_* marker nodes excluded), measured from the GLB itself.
const catalogGroups: Array<{ category: string; items: CatalogItem[] }> = [
  {
    category: 'Montanti',
    items: [
      {
        id: 'ysi12836',
        label: 'YSI 12836',
        glbUrl: '/models/MONTANTI/YSI12836.glb',
        size: [0.36, 1.008, 0.03],
        scale: 1,
        // Mounting heights read off KIT01.glb, the geometric reference for this
        // assembly. Each point is the centre of the mating face: shelves at
        // 0.612 / 0.360 above the floor, rails at 0.305. In the item-local
        // frame (collider centre, base at -size[1]/2) they sit 0.504 lower.
        // The GLB only carries markers at the foot, so without these the drag
        // finds no candidate at working height. The rails are 1.3 mm below the
        // kit: the standalone parts are ~1 mm fatter than their copies inside
        // KIT01, and at the kit's exact heights the lower shelf and the rails
        // graze each other, which the collision check reads as interference.
        // Normals point *inward* (-Z): the shelf passes through the upright and
        // its head ends flush with the outer face, so an outward normal would
        // mate the shelf on the wrong side.
        snapPoints: [
          { id: 'shelf-top', kind: 'laterale', position: [0, 0.108, 0.015], normal: [0, 0, -1] },
          { id: 'shelf-bottom', kind: 'laterale', position: [0, -0.144, 0.015], normal: [0, 0, -1] },
          { id: 'rail-xmax', kind: 'frontale', position: [0.155, -0.199, 0.0114], normal: [0, 0, -1] },
          { id: 'rail-xmin', kind: 'frontale', position: [-0.155, -0.199, 0.0114], normal: [0, 0, -1] },
        ],
      },
    ],
  },
  {
    category: 'Orizzontali',
    items: [
      // Temporarily no inferred or catalog-defined mounting holes: their
      // definitive locations will be supplied and reviewed separately.
      { id: 'xds40231km02', label: 'XDS 40231 KM02', glbUrl: '/models/ORIZZONTALI/XDS40231KM02.glb', size: [1.011, 0.07, 0.307], scale: 1 },
      // Kit-01 members. Contact points are declared here rather than read from
      // the GLB: the extractor numbers marker ids by traversal order, so a
      // re-export would silently renumber them and break manifest + saved
      // projects. Both are the centre of the end face, which is what actually
      // seats into the upright.
      {
        id: 'xds40236km02',
        label: 'XDS 40236 KM02',
        glbUrl: '/models/ORIZZONTALI/XDS40236KM02.glb',
        size: [1.013, 0.07117, 0.357],
        scale: 1,
        snapPoints: [
          { id: 'end-a', kind: 'laterale', position: [-0.5065, 0, 0], normal: [-1, 0, 0] },
          { id: 'end-b', kind: 'laterale', position: [0.5065, 0, 0], normal: [1, 0, 0] },
        ],
      },
      {
        id: 'xha40100',
        label: 'XHA 40100',
        glbUrl: '/models/ORIZZONTALI/XHA40100.glb',
        size: [0.05, 0.035, 1.00588],
        scale: 1,
        snapPoints: [
          { id: 'end-a', kind: 'frontale', position: [0, 0, 0.50294], normal: [0, 0, 1] },
          { id: 'end-b', kind: 'frontale', position: [0, 0, -0.50294], normal: [0, 0, -1] },
        ],
      },
    ],
  },
  {
    category: 'Accessori',
    items: [
      { id: 'ptbm31', label: 'PTBM-31', glbUrl: '/models/ACCESSORI/PTBM-31.glb', size: [0.31, 0.14, 0.09], scale: 1 },
    ],
  },
  {
    category: 'Kit',
    items: [
      // Pre-assembled group (XDS40236 + montanti); the body bbox excludes the
      // snap markers, which reach further on Z (full depth 1.325).
      { id: 'kit01', label: 'KIT 01', glbUrl: '/models/KIT/KIT01.glb', size: [0.36, 0.864, 1.014], scale: 1 },
    ],
  },
]

const catalog: CatalogItem[] = catalogGroups.flatMap((g) => g.items)

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
  const [catalogQuery, setCatalogQuery] = useState('')
  const [compatibleOnly, setCompatibleOnly] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const newProjectCount = useRef(0)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const project = useConfiguratorStore((s) => s.project)
  const assemblyManifest = useConfiguratorStore((s) => s.assemblyManifest)
  const selected = project?.items.find((item) => item.id === selectedId)
  const selectedConnectors = definitionFor(assemblyManifest, selected?.catalogId ?? '')?.connectors ?? []

  const connectableToSelection = (product: CatalogItem) => {
    if (!selected) return true
    const productConnectors = definitionFor(assemblyManifest, product.id)?.connectors ?? []
    return productConnectors.some((candidate) => selectedConnectors.some((current) =>
      candidate.compatibleWith?.includes(current.id) || current.compatibleWith?.includes(candidate.id),
    ))
  }

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

  const handleNewProject = () => {
    newProjectCount.current += 1
    cfg.current?.setProject({
      id: `demo-new-${newProjectCount.current}`,
      version: 1,
      enclosure: ENCLOSURE,
      items: [],
      connections: [],
      metadata: PROJECT_METADATA,
    })
    setSavedJson('')
    setLoadStatus(null)
  }

  const handleRecordDemo = async () => {
    const { default: html2canvas } = await import('html2canvas')
    const recordingCanvas = document.createElement('canvas')
    recordingCanvas.width = window.innerWidth
    recordingCanvas.height = window.innerHeight
    const recordingContext = recordingCanvas.getContext('2d')
    if (!recordingContext) throw new Error('Canvas di registrazione non disponibile')
    const stream = recordingCanvas.captureStream(30)
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'demo-kit-configuratore.webm'
      link.click()
      URL.revokeObjectURL(url)
    }

    const cursor = document.createElement('div')
    Object.assign(cursor.style, {
      position: 'fixed', zIndex: '99999', width: '22px', height: '22px',
      borderRadius: '50%', background: '#ff4d67', border: '3px solid white',
      boxShadow: '0 4px 18px rgba(0,0,0,.6)', pointerEvents: 'none',
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      transition: 'left .65s ease, top .65s ease, transform .14s ease',
    })
    const caption = document.createElement('div')
    Object.assign(caption.style, {
      position: 'fixed', zIndex: '99998', left: '50%', bottom: '34px',
      transform: 'translateX(-50%)', padding: '12px 20px', borderRadius: '9px',
      background: 'rgba(8,12,22,.88)', color: '#fff', font: '600 18px system-ui',
      letterSpacing: '.2px', boxShadow: '0 8px 30px rgba(0,0,0,.45)', pointerEvents: 'none',
    })
    document.body.append(cursor, caption)

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
    let capturing = true
    const captureFrames = async () => {
      while (capturing) {
        const sceneCanvas = document.querySelector<HTMLCanvasElement>('canvas')
        const frame = await html2canvas(document.body, {
          backgroundColor: null,
          logging: false,
          scale: 1,
          useCORS: true,
          ignoreElements: (element) => element === sceneCanvas,
        })
        recordingContext.fillStyle = '#0f1320'
        recordingContext.fillRect(0, 0, recordingCanvas.width, recordingCanvas.height)
        if (sceneCanvas) {
          const rect = sceneCanvas.getBoundingClientRect()
          recordingContext.drawImage(sceneCanvas, rect.left, rect.top, rect.width, rect.height)
        }
        recordingContext.drawImage(frame, 0, 0, recordingCanvas.width, recordingCanvas.height)
        await wait(80)
      }
    }
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((element) => element.textContent?.trim().startsWith(text))
    const moveTo = async (element: HTMLElement, label: string) => {
      caption.textContent = label
      const rect = element.getBoundingClientRect()
      cursor.style.left = `${rect.left + rect.width / 2}px`
      cursor.style.top = `${rect.top + rect.height / 2}px`
      await wait(760)
    }
    const click = async (element: HTMLElement | undefined, label: string) => {
      if (!element) throw new Error(`Controllo non trovato: ${label}`)
      await moveTo(element, label)
      cursor.style.transform = 'translate(-50%,-50%) scale(.68)'
      element.click()
      await wait(160)
      cursor.style.transform = 'translate(-50%,-50%) scale(1)'
      await wait(720)
    }
    const choose = async (selectIndex: number, optionText: string, label: string) => {
      const select = document.querySelectorAll<HTMLSelectElement>('select')[selectIndex]
      if (!select) throw new Error(`Menu non trovato: ${label}`)
      await moveTo(select, label)
      const option = [...select.options].find((entry) => entry.text.trim() === optionText || entry.text.includes(optionText))
      if (!option) throw new Error(`Opzione non trovata: ${optionText}`)
      select.value = option.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      cursor.style.transform = 'translate(-50%,-50%) scale(.68)'
      await wait(160)
      cursor.style.transform = 'translate(-50%,-50%) scale(1)'
      await wait(620)
    }
    const attach = async (targetPoint: string, label: string, setSource = true) => {
      if (setSource) await choose(0, 'end-a', 'Scelgo il punto di contatto del componente')
      const target = document.querySelectorAll<HTMLSelectElement>('select')[1]
      const firstUpright = [...target.options].find((entry) => entry.text.includes('YSI 12836'))
      if (!firstUpright) throw new Error('Montante di destinazione non trovato')
      await moveTo(target, 'Seleziono il montante di destinazione')
      target.value = firstUpright.value
      target.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(650)
      await choose(2, targetPoint, `Scelgo la sede ${label}`)
      await click(button('Aggancia'), `Aggancio ${label}`)
    }

    recorder.start(250)
    void captureFrames()
    try {
      caption.textContent = 'KIT 01 — montaggio manuale nel configuratore 3D'
      await wait(1800)
      await click(button('Nuovo'), 'Parto da un progetto vuoto')
      await click(button('YSI 12836'), 'Inserisco il primo montante YSI 12836')
      await click(button('⟳ 90°'), 'Ruoto il montante nel vano')
      await click(button('95.3 cm'), 'Creo la coppia specchiata alla distanza corretta')

      await click(button('XDS 40236 KM02'), 'Aggiungo il ripiano superiore XDS 40236 KM02')
      await attach('shelf-top', 'del ripiano superiore')
      await click(button('XDS 40236 KM02'), 'Aggiungo il ripiano inferiore')
      await attach('shelf-bottom', 'del ripiano inferiore')

      await click(button('XHA 40100'), 'Aggiungo la prima traversa XHA 40100')
      await attach('rail-xmax', 'della prima traversa')
      await click(button('XHA 40100'), 'Aggiungo la seconda traversa')
      await attach('rail-xmin', 'della seconda traversa')

      await click(button('⊙'), 'Centro la vista sul KIT completo')
      caption.textContent = 'KIT completo — configurazione valida e pronta per l’export'
      await wait(3000)
    } finally {
      capturing = false
      await wait(500)
      recorder.stop()
      stream.getTracks().forEach((track) => track.stop())
      cursor.remove()
      caption.remove()
    }
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
          catalog={catalog}
          assemblyManifest="/catalog/assembly-manifest.json"
          onSave={(p) => setSavedJson(serializeProject(p))}
        />
      </div>
      <aside style={sidebarStyle}>
        <h3 style={{ marginTop: 0 }}>Catalogo</h3>
        <p style={{ color: '#778', marginTop: 0, fontSize: 11 }}>
          Cerca e aggiungi un prodotto. Con un pezzo selezionato, il badge indica i connettori compatibili nel manifest.
        </p>

        <input
          value={catalogQuery}
          onChange={(event) => setCatalogQuery(event.target.value)}
          placeholder="Cerca codice o descrizione"
          style={catalogSearchStyle}
        />
        {selected && (
          <label style={{ display: 'flex', gap: 5, alignItems: 'center', color: '#aaa', fontSize: 11, marginBottom: 10 }}>
            <input type="checkbox" checked={compatibleOnly} onChange={(event) => setCompatibleOnly(event.target.checked)} />
            solo agganciabili al selezionato
          </label>
        )}

        <div style={{ marginBottom: 16 }}>
          {catalogGroups.map((g) => {
            const matches = g.items.filter((product) => {
              const query = catalogQuery.trim().toLowerCase()
              const textualMatch = !query || `${product.id} ${product.label}`.toLowerCase().includes(query)
              return textualMatch && (!compatibleOnly || connectableToSelection(product))
            })
            if (matches.length === 0) return null
            return (
            <details key={g.category} open style={{ marginBottom: 8 }}>
              <summary style={summaryStyle}>
                {g.category} <span style={{ color: '#778' }}>({matches.length})</span>
              </summary>
              <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0 0' }}>
                {matches.map((p) => {
                  const connectable = connectableToSelection(p)
                  return (
                  <li key={p.id} style={{ marginBottom: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleAdd(p)}
                      style={productBtnStyle}
                    >
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div style={{ color: '#778', fontSize: 10 }}>
                        {p.size ? `${p.size.map((v) => Math.round(v * 1000)).join(' × ')} mm` : p.id}
                      </div>
                      {selected && (
                        <div style={{ color: connectable ? '#77dca0' : '#778', fontSize: 10, marginTop: 2 }}>
                          {connectable ? 'agganciabile al selezionato' : 'nessun connettore compatibile'}
                        </div>
                      )}
                    </button>
                  </li>
                  )
                })}
              </ul>
            </details>
            )
          })}
        </div>

        <h3 style={{ marginBottom: 6 }}>Progetto</h3>
        <button type="button" onClick={handleRecordDemo} style={{ ...ghostBtn, width: '100%', marginBottom: 10 }}>
          Registra demo KIT
        </button>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button type="button" onClick={handleExportJson} style={ghostBtn}>
            Export JSON
          </button>
          <button type="button" onClick={handleNewProject} style={ghostBtn}>
            Nuovo
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
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
const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  padding: '4px 0',
  userSelect: 'none',
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
const catalogSearchStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginBottom: 8,
  padding: '7px 9px',
  border: '1px solid #2a2a35',
  borderRadius: 4,
  background: '#171720',
  color: '#eee',
  fontSize: 12,
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
