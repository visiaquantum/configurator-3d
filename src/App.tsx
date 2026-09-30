import { useEffect, useRef, useState } from 'react'
import {
  Configurator3D,
  parseProject,
  serializeProject,
  ProjectParseError,
  useConfiguratorStore,
  useConfiguratorStoreApi,
} from './lib'
import { beginAttachment, chooseAttachmentPoint, chooseAttachmentTarget } from './lib/scene/attachment'
import { Icon } from './lib/ui/Icon'
import { themeStyles } from './lib/ui/theme'
import { definitionFor } from './lib/assembly/manifest'
import type {
  CatalogItem,
  ConfiguratorHandle,
  ConfiguratorTheme,
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
          { id: 'shelf-top', label: 'Ripiano superiore', kind: 'laterale', position: [0, 0.108, 0.015], normal: [0, 0, -1] },
          { id: 'shelf-bottom', label: 'Ripiano inferiore', kind: 'laterale', position: [0, -0.144, 0.015], normal: [0, 0, -1] },
          { id: 'rail-xmax', label: 'Traversa destra', kind: 'frontale', position: [0.155, -0.199, 0.0114], normal: [0, 0, -1] },
          { id: 'rail-xmin', label: 'Traversa sinistra', kind: 'frontale', position: [-0.155, -0.199, 0.0114], normal: [0, 0, -1] },
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
          { id: 'end-a', label: 'Estremità A', kind: 'laterale', position: [-0.5065, 0, 0], normal: [-1, 0, 0] },
          { id: 'end-b', label: 'Estremità B', kind: 'laterale', position: [0.5065, 0, 0], normal: [1, 0, 0] },
        ],
      },
      {
        id: 'xha40100',
        label: 'XHA 40100',
        glbUrl: '/models/ORIZZONTALI/XHA40100.glb',
        size: [0.05, 0.035, 1.00588],
        scale: 1,
        snapPoints: [
          { id: 'end-a', label: 'Estremità A', kind: 'frontale', position: [0, 0, 0.50294], normal: [0, 0, 1] },
          { id: 'end-b', label: 'Estremità B', kind: 'frontale', position: [0, 0, -0.50294], normal: [0, 0, -1] },
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
  customer: 'Syncro',
}

const THEME_STORAGE_KEY = 'configurator-3d:theme'

function initialTheme(): ConfiguratorTheme {
  if (typeof window === 'undefined') return 'light'
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* The switch also works when browser storage is unavailable. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const [theme, setTheme] = useState<ConfiguratorTheme>(initialTheme)
  useEffect(() => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* Keep the current session usable without storage. */ }
  }, [theme])
  const storeApi = useConfiguratorStoreApi()
  const cfg = useRef<ConfiguratorHandle>(null)
  const [savedJson, setSavedJson] = useState('')
  const [loadStatus, setLoadStatus] = useState<{ ok: boolean; msg: string; issues?: ProjectIssue[] } | null>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [compatibleOnly, setCompatibleOnly] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const newProjectCount = useRef(0)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const attachment = useConfiguratorStore((s) => s.attachment)
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
    const attach = async (targetPoint: string, label: string) => {
      const state = storeApi.getState()
      const sourceId = state.selectedId
      const target = state.project?.items.find((item) => item.catalogId === 'ysi12836')
      if (!sourceId || !target || !beginAttachment(storeApi, sourceId)) throw new Error('Componente di partenza non disponibile')
      caption.textContent = 'Scelgo il punto iniziale nella scena'
      await wait(800)
      if (!chooseAttachmentPoint(storeApi, 'end-a')) throw new Error('Punto iniziale non disponibile')
      caption.textContent = 'Scelgo il montante di destinazione'
      await wait(800)
      if (!chooseAttachmentTarget(storeApi, target.id)) throw new Error('Destinatario non disponibile')
      const interaction = storeApi.getState().attachment
      if (interaction) storeApi.getState().setAttachment({ ...interaction, hoveredPointId: targetPoint })
      caption.textContent = `Anteprima dell’aggancio ${label}`
      await wait(1000)
      if (!chooseAttachmentPoint(storeApi, targetPoint)) throw new Error(storeApi.getState().attachment?.error ?? 'Aggancio non valido')
      await wait(800)
    }

    recorder.start(250)
    void captureFrames()
    try {
      caption.textContent = 'KIT 01 — montaggio manuale nel configuratore 3D'
      await wait(1800)
      await click(button('Nuovo'), 'Parto da un progetto vuoto')
      await click(button('YSI 12836'), 'Inserisco il primo montante YSI 12836')
      await click(button('+90°'), 'Ruoto il montante nel vano')
      document.querySelector<HTMLDetailsElement>('.cfg-inspector details')?.setAttribute('open', '')
      await click(button('95.3 cm'), 'Creo la coppia specchiata alla distanza corretta')

      await click(button('XDS 40236 KM02'), 'Aggiungo il ripiano superiore XDS 40236 KM02')
      await attach('shelf-top', 'del ripiano superiore')
      await click(button('XDS 40236 KM02'), 'Aggiungo il ripiano inferiore')
      await attach('shelf-bottom', 'del ripiano inferiore')

      await click(button('XHA 40100'), 'Aggiungo la prima traversa XHA 40100')
      await attach('rail-xmax', 'della prima traversa')
      await click(button('XHA 40100'), 'Aggiungo la seconda traversa')
      await attach('rail-xmin', 'della seconda traversa')

      await click(document.querySelector<HTMLButtonElement>('[aria-label="Centra componente"]') ?? undefined, 'Centro la vista sul KIT completo')
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
      storeApi.getState().setProject(project)
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

  const matches = catalogGroups.flatMap((group) => group.items.filter((product) => {
    const query = catalogQuery.trim().toLowerCase()
    return (!query || `${product.id} ${product.label}`.toLowerCase().includes(query)) && (!compatibleOnly || connectableToSelection(product))
  }))

  return (
    <div className="app-shell" data-theme={theme}>
      <style>{themeStyles}</style>
      <header className="app-header">
        <div className="app-brand"><span className="app-brand-icon"><Icon name="cube" size={22} /></span><div><strong>Syncro</strong><small>Configuratore di allestimenti · 3D</small></div></div>
        <div className="app-project-name"><span className="app-status-dot" />Allestimento furgone<span className="app-header-count">{project?.items.length ?? 0} {(project?.items.length ?? 0) === 1 ? 'componente' : 'componenti'}</span></div>
        <div className="app-header-actions">
          <div className="app-theme-switch" role="group" aria-label="Tema interfaccia">
            <button aria-label="Tema chiaro" aria-pressed={theme === 'light'} onClick={() => setTheme('light')} title="Tema chiaro"><Icon name="sun" size={15} /><span>Chiaro</span></button>
            <button aria-label="Tema scuro" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} title="Tema scuro"><Icon name="moon" size={15} /><span>Scuro</span></button>
          </div>
          <button aria-label="Apri progetto" onClick={() => fileRef.current?.click()}><Icon name="folder" size={16} /><span>Apri progetto</span></button><button className="app-primary-action" aria-label="Nuovo progetto" onClick={handleNewProject}><Icon name="plus" size={16} /><span>Nuovo progetto</span></button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImport(file); event.target.value = '' }} />
      </header>
      <main className="app-workspace">
        <div className="app-viewport">
          <div className="app-viewport-heading"><span><Icon name="cube" size={15} />Area di progettazione</span><span>FIAT · NDC 40H2</span></div>
          <div className="app-canvas"><Configurator3D ref={cfg} theme={theme} enclosure={ENCLOSURE} projectId="demo-010" metadata={PROJECT_METADATA} catalog={catalog} assemblyManifest="/catalog/assembly-manifest.json" environmentUrl="/hdr/empty_warehouse_01_4k.hdr" onSave={(value) => setSavedJson(serializeProject(value))} /></div>
        </div>
        <aside className="app-sidebar">
          <div className="app-sidebar-heading"><div><span className="app-eyebrow">CATALOGO PRODOTTI</span><h2>Componenti</h2></div><span className="app-count-badge">{catalog.length}</span></div>
          <p className="app-sidebar-intro">Seleziona un componente per aggiungerlo al progetto.</p>
          <label className="app-search"><Icon name="search" size={17} /><input aria-label="Cerca componenti" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Cerca un componente…" /></label>
          {selected && <label className="app-compatible-filter"><input type="checkbox" checked={compatibleOnly} onChange={(event) => setCompatibleOnly(event.target.checked)} />Compatibili con {catalog.find((product) => product.id === selected.catalogId)?.label ?? selected.catalogId}</label>}
          <div className="app-catalog">
            {catalogGroups.map((group) => {
              const items = group.items.filter((product) => matches.includes(product))
              if (!items.length) return null
              return <details key={group.category} open className="app-category"><summary>{group.category}<span>{items.length}</span></summary><div className="app-product-list">
                {items.map((product) => <button key={product.id} className="app-product-card" disabled={!!attachment} aria-label={`Aggiungi ${product.label}`} onClick={() => handleAdd(product)}>
                  <span className="app-product-graphic"><img src={`/catalog/previews/${product.id}.png`} alt="" width={68} height={62} loading="lazy" /></span><span className="app-product-info"><strong>{product.label}</strong><small>{product.size?.map((value) => Math.round(value * 1000)).join(' × ')} mm</small>{selected && connectableToSelection(product) && <span className="app-compatible-badge">Compatibile</span>}</span><span className="app-add-icon"><Icon name="plus" size={16} /></span>
                </button>)}
              </div></details>
            })}
            {!matches.length && <div className="app-no-results"><Icon name="search" size={25} /><strong>Nessun componente trovato</strong><span>Prova un altro codice o disattiva il filtro.</span></div>}
          </div>
          {!!project?.items.length && <section className="app-scene-list"><div className="app-section-heading"><Icon name="layers" size={15} />Nella scena<span>{project.items.length}</span></div>{project.items.map((item, index) => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} disabled={!!attachment && attachment.stage !== 'target'} onClick={() => attachment?.stage === 'target' ? chooseAttachmentTarget(storeApi, item.id) : cfg.current?.selectItem(item.id)}><span>{String(index + 1).padStart(2, '0')}</span>{catalog.find((product) => product.id === item.catalogId)?.label ?? item.catalogId}<Icon name="focus" size={13} /></button>)}</section>}
          <div className="app-sidebar-footer"><span className="app-tip-icon"><Icon name="link" size={16} /></span><div><strong>Unisci i componenti</strong><span>Tasto destro su un pezzo → Aggancia.</span></div></div>
          {loadStatus && <p className={`app-import-status ${loadStatus.ok ? '' : 'error'}`} role="status">{loadStatus.msg}</p>}
          <details className="app-project-tools"><summary>Strumenti progetto</summary><div><button onClick={handleExportJson}><Icon name="download" size={14} />Scarica JSON</button><button onClick={() => { void handleRecordDemo().catch((error: Error) => setLoadStatus({ ok: false, msg: error.message })) }}>Registra demo KIT</button></div>{savedJson && <details><summary>Dati dell’ultimo salvataggio</summary><pre>{savedJson}</pre></details>}</details>
        </aside>
      </main>
      <footer className="app-status-bar"><span><span>Trascina · Sposta</span><span>Rotellina · Zoom</span><span>Tasto destro · Aggancia</span></span><span>Scala reale · Coordinate in metri</span></footer>
    </div>
  )
}
