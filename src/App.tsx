import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Configurator3D,
  buildCatalogFromIndex,
  catalogRevisionPointerUrl,
  chooseAttachmentTarget,
  compatibleCatalogIds,
  loadCatalogRevision,
  parseProject,
  productCompatibility,
  serializeProject,
  ProjectParseError,
  useConfiguratorStore,
  useConfiguratorStoreApi,
  Icon,
  themeStyles,
} from './lib'
import type {
  AssemblyManifest,
  BuiltCatalog,
  CatalogEnclosure,
  CatalogItem,
  ConfiguratorHandle,
  ConfiguratorTheme,
  ProjectData,
  ProjectIssue,
  ProjectMetadata,
} from './lib'

/**
 * Test application around the configurator. It knows no product: the
 * catalogue, its rules and the vehicles come from the published revision the
 * backend serves (`current.json` → index of the GLB folder + manifest), so a
 * new product is a GLB and a manifest entry, never a code change.
 */
const CATALOG_URL = '/catalog/current.json'

const PROJECT_METADATA: ProjectMetadata = { name: 'Nuovo allestimento' }

const THEME_STORAGE_KEY = 'configurator-3d:theme'

function initialTheme(): ConfiguratorTheme {
  if (typeof window === 'undefined') return 'light'
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* The switch also works when browser storage is unavailable. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface LoadedCatalog {
  revision: string
  built: BuiltCatalog
  manifest: AssemblyManifest
}

type CatalogState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; catalog: LoadedCatalog }

async function fetchCatalog(pointerUrl: string, signal?: AbortSignal): Promise<LoadedCatalog> {
  const { index, manifest } = await loadCatalogRevision(pointerUrl, { signal })
  return { revision: index.revision, built: buildCatalogFromIndex(index, manifest), manifest }
}

type Status = { ok: boolean; msg: string; issues?: ProjectIssue[]; retry?: () => void }

export default function App() {
  const [theme, setTheme] = useState<ConfiguratorTheme>(initialTheme)
  useEffect(() => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* Keep the current session usable without storage. */ }
  }, [theme])
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetchCatalog(CATALOG_URL, controller.signal)
      .then((catalog) => setCatalogState({ status: 'ready', catalog }))
      .catch((error: Error) => { if (!controller.signal.aborted) setCatalogState({ status: 'error', message: error.message }) })
    return () => controller.abort()
  }, [])

  return (
    <div className="app-shell" data-theme={theme}>
      <style>{themeStyles}</style>
      {catalogState.status === 'ready'
        ? <Workspace catalog={catalogState.catalog} theme={theme} setTheme={setTheme}
          onCatalog={(catalog) => setCatalogState({ status: 'ready', catalog })} />
        : <main className="app-workspace app-catalog-state" role="status">
          {catalogState.status === 'loading'
            ? <><Icon name="cube" size={22} /><strong>Caricamento del catalogo…</strong></>
            : <><Icon name="close" size={22} /><strong>Catalogo non disponibile</strong><span>{catalogState.message}</span></>}
        </main>}
    </div>
  )
}

function Workspace({ catalog, theme, setTheme, onCatalog }: {
  catalog: LoadedCatalog
  theme: ConfiguratorTheme
  setTheme: (theme: ConfiguratorTheme) => void
  onCatalog: (catalog: LoadedCatalog) => void
}) {
  const { built, manifest, revision } = catalog
  const items = built.items
  const vehicles = built.enclosures
  const storeApi = useConfiguratorStoreApi()
  const cfg = useRef<ConfiguratorHandle>(null)
  const [savedJson, setSavedJson] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [compatibleOnly, setCompatibleOnly] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const projectCount = useRef(0)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const attachment = useConfiguratorStore((s) => s.attachment)
  const project = useConfiguratorStore((s) => s.project)
  const selected = project?.items.find((item) => item.id === selectedId)
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const [initialVehicle] = useState(() => vehicles[0])
  // Props the configurator resets on: stable for the life of this revision.
  const enclosure = useMemo(() => initialVehicle?.enclosure ?? { glbUrl: '' }, [initialVehicle])
  const vehicle = vehicles.find((entry) => entry.id === project?.catalog?.enclosureId) ??
    vehicles.find((entry) => entry.enclosure.glbUrl === project?.enclosure.glbUrl) ?? initialVehicle

  const compatible = useMemo(() => new Set(selected ? compatibleCatalogIds(manifest, selected.catalogId) : []), [manifest, selected])
  const newProject = useCallback((next: CatalogEnclosure | undefined = vehicle): ProjectData => {
    projectCount.current += 1
    return {
      id: `allestimento-${Date.now().toString(36)}-${projectCount.current}`,
      version: 1,
      enclosure: next?.enclosure ?? enclosure,
      items: [],
      connections: [],
      metadata: { ...PROJECT_METADATA, vehicle: next?.label },
      catalog: { revision, ...(next ? { enclosureId: next.id } : {}) },
    }
  }, [enclosure, revision, vehicle])

  // A project opened with another revision waits for that catalogue to reach
  // the configurator: child effects run first, so it is in place here.
  const pendingProject = useRef<ProjectData | null>(null)
  useEffect(() => {
    if (!pendingProject.current) return
    storeApi.getState().setProject(pendingProject.current)
    pendingProject.current = null
  }, [revision, storeApi])
  // Every project of this workspace names the revision its ids belong to.
  useEffect(() => {
    const current = storeApi.getState().project
    if (current && current.catalog?.revision !== revision) storeApi.getState().setProject({ ...current, catalog: { revision, ...(vehicle ? { enclosureId: vehicle.id } : {}) } })
  }, [project, revision, storeApi, vehicle])

  const handleExportJson = () => {
    const current = cfg.current?.getProject()
    if (!current) return
    const url = URL.createObjectURL(new Blob([serializeProject(current)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${current.id || 'progetto'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Swapping the van keeps the parts where they are; the validation flags what no longer fits.
  const handleVehicle = (id: string) => {
    const current = cfg.current?.getProject()
    const next = vehicles.find((candidate) => candidate.id === id)
    if (current && next) cfg.current?.setProject({ ...current, enclosure: next.enclosure, catalog: { revision, enclosureId: next.id }, metadata: { ...current.metadata, vehicle: next.label } })
  }

  const handleNewProject = () => {
    cfg.current?.setProject(newProject())
    setSavedJson('')
    setStatus(null)
  }

  /**
   * A project opens with the revision it was composed with: its product,
   * point and connector ids mean what they meant then. A missing revision is
   * reported and the user decides; nothing is replaced silently.
   */
  const openProject = async (text: string, force = false) => {
    try {
      const parsed = parseProject(text)
      const wanted = parsed.project.catalog?.revision
      let target = catalog
      if (wanted && wanted !== revision && !force) {
        try {
          target = await fetchCatalog(catalogRevisionPointerUrl(new URL(CATALOG_URL, location.href).href, wanted))
        } catch {
          setStatus({ ok: false, msg: `Il progetto usa la revisione del catalogo ${wanted}, non più disponibile. Non è stato aperto: i suoi prodotti potrebbero non corrispondere a quelli attuali.`, retry: () => void openProject(text, true) })
          return
        }
      }
      const { project: loaded, warnings } = parseProject(text, { catalog: target.built.items, catalogRevision: target.revision })
      const next = { ...loaded, catalog: { ...loaded.catalog, revision: target.revision } }
      if (target !== catalog) {
        pendingProject.current = next
        onCatalog(target)
      } else storeApi.getState().setProject(next)
      setStatus({
        ok: true,
        msg: `Aperto «${loaded.metadata?.name ?? loaded.id}» con ${loaded.items.length} componenti · catalogo ${target.revision}${target !== catalog ? ' (revisione del progetto)' : ''}${warnings.length ? ` · ${warnings.length} avvisi` : ''}`,
        issues: warnings,
      })
    } catch (error) {
      setStatus(error instanceof ProjectParseError ? { ok: false, msg: error.message, issues: error.issues } : { ok: false, msg: (error as Error).message })
    }
  }

  const query = catalogQuery.trim().toLowerCase()
  const matches = items.filter((product) =>
    (!query || [product.id, product.code, product.label, product.description, product.category].join(' ').toLowerCase().includes(query)) &&
    (!compatibleOnly || !selected || compatible.has(product.id)))
  const selectedLabel = selected ? byId.get(selected.catalogId)?.label ?? selected.catalogId : ''
  const catalogErrors = built.issues.filter((issue) => issue.level === 'error')

  return (
    <>
      <header className="app-header">
        <div className="app-brand"><span className="app-brand-icon"><Icon name="cube" size={22} /></span><div><strong>Syncro</strong><small>Configuratore di allestimenti · 3D</small></div></div>
        <div className="app-project-name"><span className="app-status-dot" />{project?.metadata?.name ?? 'Allestimento'}<span className="app-header-count">{project?.items.length ?? 0} {(project?.items.length ?? 0) === 1 ? 'componente' : 'componenti'}</span></div>
        <div className="app-header-actions">
          <div className="app-theme-switch" role="group" aria-label="Tema interfaccia">
            <button aria-label="Tema chiaro" aria-pressed={theme === 'light'} onClick={() => setTheme('light')} title="Tema chiaro"><Icon name="sun" size={15} /><span>Chiaro</span></button>
            <button aria-label="Tema scuro" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} title="Tema scuro"><Icon name="moon" size={15} /><span>Scuro</span></button>
          </div>
          <a className="app-header-link" href="/stl-to-glb.html" title="Converti un rilievo STL in GLB per il catalogo"><Icon name="cube" size={16} /><span>Converti STL</span></a>
          <button aria-label="Apri progetto" onClick={() => fileRef.current?.click()}><Icon name="folder" size={16} /><span>Apri progetto</span></button><button className="app-primary-action" aria-label="Nuovo progetto" onClick={handleNewProject}><Icon name="plus" size={16} /><span>Nuovo progetto</span></button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="File progetto" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((text) => openProject(text)); event.target.value = '' }} />
      </header>
      <main className="app-workspace">
        <div className="app-viewport">
          <div className="app-viewport-heading"><span><Icon name="cube" size={15} />Area di progettazione</span>
            <select className="app-vehicle-select" aria-label="Veicolo" value={vehicle?.id ?? ''} onChange={(event) => handleVehicle(event.target.value)}>{vehicles.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          </div>
          <div className="app-canvas"><Configurator3D ref={cfg} theme={theme} enclosure={enclosure} projectId="allestimento" metadata={PROJECT_METADATA} catalog={items} assemblyManifest={manifest} environmentUrl="/hdr/empty_warehouse_01_4k.hdr" onSave={(value) => setSavedJson(serializeProject(value))} /></div>
        </div>
        <aside className="app-sidebar">
          <div className="app-sidebar-heading"><div><span className="app-eyebrow">CATALOGO PRODOTTI</span><h2>Componenti</h2></div><span className="app-count-badge">{items.length}</span></div>
          <p className="app-sidebar-intro">Seleziona un componente per aggiungerlo al progetto. Catalogo <code>{revision}</code>.</p>
          {built.issues.length > 0 && <details className="app-catalog-issues"><summary>{catalogErrors.length ? `${catalogErrors.length} prodotti esclusi dal catalogo` : `${built.issues.length} avvisi del catalogo`}</summary><ul>{built.issues.map((issue, index) => <li key={index} className={issue.level}>{issue.message}</li>)}</ul></details>}
          <label className="app-search"><Icon name="search" size={17} /><input aria-label="Cerca componenti" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Codice, nome o descrizione…" /></label>
          {selected && <label className="app-compatible-filter"><input type="checkbox" checked={compatibleOnly} onChange={(event) => setCompatibleOnly(event.target.checked)} />Solo compatibili con {selectedLabel}</label>}
          <div className="app-catalog">
            {built.categories.map((category) => {
              const group = matches.filter((product) => (product.category ?? '') === category)
              if (!group.length) return null
              return <details key={category} open className="app-category"><summary>{category || 'Altro'}<span>{group.length}</span></summary><div className="app-product-list">
                {group.map((product) => <ProductCard key={product.id} product={product} disabled={!!attachment} onAdd={() => cfg.current?.addItem(product)}
                  compatibility={selected ? productCompatibility(manifest, selected.catalogId, product.id) : null} />)}
              </div></details>
            })}
            {!matches.length && <div className="app-no-results"><Icon name="search" size={25} /><strong>Nessun componente trovato</strong><span>Prova un altro codice o disattiva il filtro.</span></div>}
          </div>
          {!!project?.items.length && <section className="app-scene-list"><div className="app-section-heading"><Icon name="layers" size={15} />Nella scena<span>{project.items.length}</span></div>{project.items.map((item, index) => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} disabled={!!attachment && attachment.stage !== 'target'} onClick={() => attachment?.stage === 'target' ? chooseAttachmentTarget(storeApi, item.id) : cfg.current?.selectItem(item.id)}><span>{String(index + 1).padStart(2, '0')}</span>{byId.get(item.catalogId)?.label ?? item.catalogId}<Icon name="focus" size={13} /></button>)}</section>}
          <div className="app-sidebar-footer"><span className="app-tip-icon"><Icon name="link" size={16} /></span><div><strong>Unisci i componenti</strong><span>Tasto destro su un pezzo → Aggancia, oppure «Aggancia nella scena» nel pannello del componente.</span></div></div>
          {status && <div className={`app-import-status ${status.ok ? '' : 'error'}`} role="status"><p>{status.msg}</p>
            {status.retry && <button onClick={status.retry}>Apri con la revisione corrente</button>}
            {!!status.issues?.length && <ul>{status.issues.map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul>}
          </div>}
          <details className="app-project-tools"><summary>Strumenti progetto</summary><div><button onClick={handleExportJson}><Icon name="download" size={14} />Scarica JSON</button></div>{savedJson && <details><summary>Dati dell’ultimo salvataggio</summary><pre>{savedJson}</pre></details>}</details>
        </aside>
      </main>
      <footer className="app-status-bar"><span><span>Trascina · Sposta</span><span>Rotellina · Zoom</span><span>Tasto destro · Aggancia</span></span><span>Scala reale · Coordinate in metri</span></footer>
    </>
  )
}

const INCOMPATIBILITY_LABELS = {
  'not-in-manifest': 'Non descritto nel manifest',
  'no-connectors': 'Senza punti di aggancio',
  'incompatible-family': 'Famiglie di aggancio non compatibili',
} as const

function ProductCard({ product, disabled, onAdd, compatibility }: {
  product: CatalogItem
  disabled: boolean
  onAdd: () => void
  compatibility: ReturnType<typeof productCompatibility> | null
}) {
  const [failed, setFailed] = useState(false)
  return <div className="app-product-entry">
    <button className="app-product-card" disabled={disabled} aria-label={`Aggiungi ${product.label}`} onClick={onAdd} title={product.description}>
      <span className="app-product-graphic">{product.previewUrl && !failed
        ? <img src={product.previewUrl} alt="" width={68} height={62} loading="lazy" onError={() => setFailed(true)} />
        : <Icon name="cube" size={24} />}</span>
      <span className="app-product-info"><strong>{product.label}</strong>
        <small>{product.code} · {product.size?.map((value) => Math.round(value * (product.scale ?? 1) * 1000)).join(' × ')} mm</small>
        {compatibility && (compatibility.compatible
          ? <span className="app-compatible-badge">Compatibile</span>
          : <span className="app-incompatible-note">{INCOMPATIBILITY_LABELS[compatibility.reason!]}</span>)}
      </span>
      <span className="app-add-icon"><Icon name="plus" size={16} /></span>
    </button>
    {(product.description || product.instructions?.length) && <details className="app-product-details"><summary>Dettagli e montaggio</summary>
      {product.description && <p>{product.description}</p>}
      {!!product.instructions?.length && <ol>{product.instructions.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    </details>}
  </div>
}
