import { useEffect, useRef, useState } from 'react'
import { Configurator3D, createConfiguratorStore, downloadBlob, parseProject, serializeProject } from 'configurator-3d'
import type { ConfiguratorHandle, ProjectData } from 'configurator-3d'
import { loadExample, resolveProjectAssets } from './data'
import type { ExampleData } from './data'

const STORAGE_KEY = 'configurator-integration:project'

export function App() {
  const [data, setData] = useState<ExampleData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadExample(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setData(loaded)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError((cause as Error).message)
    })
    return () => controller.abort()
  }, [])

  if (error) return <main className="loading" role="alert">Impossibile aprire l’esempio: {error}</main>
  if (!data) return <main className="loading" role="status">Caricamento catalogo e configurazione…</main>
  return <Workspace data={data} />
}

function Workspace({ data }: { data: ExampleData }) {
  const [store] = useState(() => {
    const instance = createConfiguratorStore()
    instance.getState().setCutawayEnabled(true)
    return instance
  })
  const ref = useRef<ConfiguratorHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [project, setProject] = useState<ProjectData | null>(null)
  const [message, setMessage] = useState('Apri l’assieme completo oppure aggiungi un prodotto dal catalogo.')
  const [error, setError] = useState<string | null>(null)

  // Only serializable data crosses this boundary. Replace localStorage with
  // your gestionale API here, leaving the configurator component unchanged.
  const saveProject = (value: ProjectData) => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeProject(value))
      setMessage('Configurazione salvata in questo browser.')
      setError(null)
    } catch (cause) { setError(`Salvataggio non riuscito: ${(cause as Error).message}`) }
  }

  const openProject = (raw: unknown) => {
    const parsed = parseProject(raw, { catalog: data.catalog })
    if (parsed.warnings.length) throw new Error(parsed.warnings.map((warning) => warning.message).join('; '))
    ref.current?.setProject(resolveProjectAssets(parsed.project))
    setError(null)
    setMessage('Configurazione aperta.')
  }

  const restoreSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) throw new Error('Non ci sono configurazioni salvate in questo browser.')
      openProject(raw)
    } catch (cause) { setError((cause as Error).message) }
  }

  const importFile = async (file: File) => {
    try { openProject(await file.text()) }
    catch (cause) { setError((cause as Error).message) }
  }

  const downloadProject = () => {
    const current = ref.current?.getProject()
    if (current) downloadBlob(new Blob([serializeProject(current)], { type: 'application/json' }), `${current.id}.json`)
  }

  const newProject = () => {
    openProject({ ...data.project, id: `progetto-${crypto.randomUUID()}`, items: [], connections: [] })
  }

  return (
    <main className="workspace">
      <header className="header">
        <div><p className="eyebrow">ESEMPIO REACT · INTEGRAZIONE GESTIONALE</p><h1>Configuratore 3D</h1></div>
        <div className="actions">
          <button onClick={newProject}>Nuovo progetto</button>
          <button onClick={() => openProject(data.project)}>Apri assieme completo</button>
          <button onClick={restoreSaved}>Riapri salvataggio</button>
          <button onClick={() => importRef.current?.click()}>Importa JSON</button>
          <button onClick={downloadProject}>Scarica JSON</button>
        </div>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }} />
      </header>
      <section className="content">
        <div className="viewport" aria-label="Area configuratore 3D">
          <Configurator3D
            ref={ref}
            store={store}
            enclosure={data.project.enclosure}
            projectId="integrazione-gestionale"
            catalog={data.catalog}
            assemblyManifest={data.manifest}
            onChange={setProject}
            onSave={saveProject}
          />
        </div>
        <aside className="sidebar">
          <p className="eyebrow">CATALOGO DI ESEMPIO</p>
          <h2>Componenti</h2>
          <p>Tre prodotti con modelli e punti di aggancio coerenti con il manifest.</p>
          {data.catalog.map((product) => (
            <button className="product" key={product.id} onClick={() => ref.current?.addItem(product)}>
              <strong>{product.label}</strong>
              <span>{product.size?.map((size) => Math.round(size * 1000)).join(' × ')} mm</span>
              <span>Aggiungi al progetto +</span>
            </button>
          ))}
          <div className="help"><strong>Prova l’assieme completo</strong><p>Due montanti, due ripiani e due traverse già collegati. Usa “Apri assieme completo”, poi “Esporta” per provare PNG, GLB o distinta PDF.</p></div>
          <div className="help"><strong>Assemblaggio manuale</strong><p>Aggiungi un pezzo, poi tasto destro → Aggancia nella scena. Seleziona il punto iniziale, il componente destinatario e il suo punto di aggancio.</p></div>
          <p aria-live="polite">Componenti nella scena: <strong>{project?.items.length ?? 0}</strong></p>
        </aside>
      </section>
      <footer className="status" role="status">{message}</footer>
      {error && <div className="error" role="alert">{error}</div>}
    </main>
  )
}
