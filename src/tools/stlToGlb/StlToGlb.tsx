import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Canvas } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Bounds, Grid, Html, OrbitControls } from '@react-three/drei'
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Vector3 } from 'three'
import { ANCHOR_ID_RE, glbByteLength, writeGlb } from './core'
import type { GlbAnchor, OrientOptions, StlUnit, UpAxis } from './core'
import type { WorkerRequest, WorkerResponse } from './protocol'

/** Catalogue limits checked by `npm run catalog:check` (model-heavy). */
const MAX_TRIANGLES = 200_000
const MAX_BYTES = 8 * 1024 * 1024
const MIN_TARGET = 5_000
const PRESETS = [
  { label: 'Leggero', triangles: 50_000 },
  { label: 'Consigliato', triangles: 150_000 },
  { label: 'Dettagliato', triangles: 300_000 },
]

type Result = Extract<WorkerResponse, { type: 'result' }>

const formatCount = (n: number) => n.toLocaleString('it-IT')
const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`
const formatM = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Vec3 = [number, number, number]
const toMm = (v: number) => Math.round(v * 1000) / 1000

/** Unit normal, snapped to the nearest axis when it is within ~25° of it. */
function cleanNormal(normal: Vector3): Vec3 {
  const n = normal.clone().normalize()
  const axis = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]
  const major = axis.indexOf(Math.max(...axis))
  if (axis[major] > 0.9) return [0, 1, 2].map((k) => (k === major ? Math.sign(n.getComponent(k)) : 0)) as Vec3
  return [n.x, n.y, n.z].map((v) => Math.round(v * 1000) / 1000) as Vec3
}

/** Code from the file name, as the catalogue expects it: `furgone interno.stl` → `FURGONE-INTERNO`. */
function codeFromName(name: string): string {
  return name.replace(/\.stl$/i, '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'VEICOLO'
}

export function StlToGlb() {
  const workerRef = useRef<Worker | null>(null)
  const [fileName, setFileName] = useState('')
  const [code, setCode] = useState('')
  const [source, setSource] = useState<Extract<WorkerResponse, { type: 'loaded' }> | null>(null)
  const [orient, setOrient] = useState<OrientOptions>({ unit: 'mm', up: 'z', quarterTurns: 0, centerOnFloor: true })
  const [target, setTarget] = useState(150_000)
  const [prune, setPrune] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [anchors, setAnchors] = useState<GlbAnchor[]>([])
  const [placing, setPlacing] = useState(false)
  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestId = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)

  // One worker per mount (StrictMode mounts twice: the first one is terminated).
  useEffect(() => {
    const next = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    next.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'loaded') {
        setSource(message)
        setOrient((current) => ({ ...current, unit: message.unit }))
        setTarget(Math.min(150_000, message.triangles))
      } else if (message.type === 'result') {
        if (message.id !== requestId.current) return
        setResult(message)
        setBusy(null)
      } else {
        if (message.id !== undefined && message.id !== requestId.current) return
        setError(message.message)
        setBusy(null)
      }
    }
    workerRef.current = next
    return () => { next.terminate(); workerRef.current = null }
  }, [])

  // Re-run the conversion when an option changes; the worker keeps the welded mesh per orientation.
  useEffect(() => {
    const worker = workerRef.current
    if (!source || !worker) return
    const id = ++requestId.current
    const timer = window.setTimeout(() => {
      setBusy('Semplificazione in corso…')
      setError(null)
      worker.postMessage({ type: 'process', id, orient, targetTriangles: target, prune } satisfies WorkerRequest)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [source, orient, target, prune])

  const openFile = useCallback(async (file: File) => {
    const worker = workerRef.current
    if (!worker) return
    if (!/\.stl$/i.test(file.name)) { setError(`${file.name} non è un file .stl`); return }
    setFileName(file.name)
    setCode(codeFromName(file.name))
    setSource(null)
    setResult(null)
    setError(null)
    setAnchors([])
    setPlacing(false)
    setSelectedAnchor(null)
    setBusy('Lettura dell’STL…')
    const buffer = await file.arrayBuffer()
    worker.postMessage({ type: 'load', buffer } satisfies WorkerRequest, [buffer])
  }, [])

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void openFile(file)
  }

  const addAnchor = useCallback((position: Vec3, normal: Vec3, onFloor: boolean) => {
    setAnchors((current) => {
      const prefix = onFloor ? 'pavimento' : 'punto'
      let n = current.length + 1
      while (current.some((anchor) => anchor.id === `${prefix}-${n}`)) n++
      setSelectedAnchor(current.length)
      return [...current, { id: `${prefix}-${n}`, position: position.map(toMm) as Vec3, normal }]
    })
  }, [])
  const updateAnchor = (index: number, patch: Partial<GlbAnchor>) => setAnchors((current) => current.map((anchor, i) => (i === index ? { ...anchor, ...patch } : anchor)))
  const removeAnchor = (index: number) => {
    setAnchors((current) => current.filter((_, i) => i !== index))
    setSelectedAnchor(null)
  }
  const anchorIssue = anchors.find((anchor) => !ANCHOR_ID_RE.test(anchor.id))
    ? 'Nomi dei punti: solo lettere, cifre, - e _.'
    : new Set(anchors.map((anchor) => anchor.id)).size !== anchors.length ? 'Due punti hanno lo stesso nome.' : null
  const copyAnchors = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(anchors, null, 2))
      setNotice('Punti copiati: incollali in "anchors" del veicolo nel manifest.')
    } catch {
      setNotice('Copia non riuscita: il browser non consente l’accesso agli appunti.')
    }
  }

  const download = () => {
    if (!result || anchorIssue) return
    const glb = writeGlb({ positions: result.positions, normals: result.normals, indices: result.indices, error: result.error }, code, anchors)
    const url = URL.createObjectURL(new Blob([glb as BlobPart], { type: 'model/gltf-binary' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${code}.glb`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const resultTriangles = result ? result.indices.length / 3 : 0
  const resultVertices = result ? result.positions.length / 3 : 0
  const bytes = result ? glbByteLength(resultVertices, result.indices.length) : 0
  const maxTarget = source?.triangles ?? 1_000_000
  const sliderValue = Math.log(Math.max(MIN_TARGET, Math.min(target, maxTarget)))
  const tooHeavy = resultTriangles > MAX_TRIANGLES || bytes > MAX_BYTES
  const setOption = <K extends keyof OrientOptions>(key: K, value: OrientOptions[K]) => {
    // The points are in the converted frame: a new orientation moves the model under them.
    if (anchors.length) setNotice('Orientamento cambiato: i punti di aggancio sono stati rimossi.')
    setAnchors([])
    setSelectedAnchor(null)
    setOrient((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="stl-shell" onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <header className="stl-header">
        <div>
          <strong>Conversione STL → GLB</strong>
          <small>Rilievi dei veicoli per il catalogo del configuratore</small>
        </div>
        <a className="stl-link" href="/">← Configuratore</a>
      </header>
      <main className="stl-workspace">
        <aside className="stl-panel">
          <section>
            <h2>1 · File</h2>
            <input ref={fileRef} type="file" accept=".stl" hidden aria-label="File STL" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = '' }} />
            <button className="stl-primary" onClick={() => fileRef.current?.click()}>Scegli un file STL…</button>
            <p className="stl-hint">{fileName ? <>{fileName}{source ? <> · {formatCount(source.triangles)} triangoli</> : null}</> : 'Oppure trascinalo in questa pagina.'}</p>
          </section>

          <section aria-disabled={!source}>
            <h2>2 · Orientamento</h2>
            <label className="stl-field">Unità del file
              <select value={orient.unit} disabled={!source} onChange={(event) => setOption('unit', event.target.value as StlUnit)}>
                <option value="mm">millimetri</option>
                <option value="cm">centimetri</option>
                <option value="m">metri</option>
              </select>
            </label>
            <label className="stl-field">Asse verticale del file
              <select value={orient.up} disabled={!source} onChange={(event) => setOption('up', event.target.value as UpAxis)}>
                <option value="z">Z (CAD, scanner)</option>
                <option value="y">Y</option>
              </select>
            </label>
            <div className="stl-field">Rotazione orizzontale
              <div className="stl-row">
                <span>{orient.quarterTurns * 90}°</span>
                <button disabled={!source} onClick={() => setOption('quarterTurns', (orient.quarterTurns + 1) % 4)}>Ruota 90°</button>
              </div>
            </div>
            <label className="stl-check"><input type="checkbox" checked={orient.centerOnFloor} disabled={!source} onChange={(event) => setOption('centerOnFloor', event.target.checked)} />Origine al centro del pianale</label>
            {source && <p className="stl-hint">Ingombro nel file: {source.extent.map((v) => v.toLocaleString('it-IT', { maximumFractionDigits: 1 })).join(' × ')} {orient.unit}</p>}
          </section>

          <section>
            <h2>3 · Grado di conversione</h2>
            <div className="stl-presets">
              {PRESETS.map((preset) => (
                <button key={preset.label} disabled={!source} className={target === Math.min(preset.triangles, maxTarget) ? 'is-active' : ''} onClick={() => setTarget(Math.min(preset.triangles, maxTarget))}>
                  {preset.label}<small>{formatCount(preset.triangles / 1000)}k</small>
                </button>
              ))}
              <button disabled={!source} className={target === maxTarget ? 'is-active' : ''} onClick={() => setTarget(maxTarget)}>Originale<small>100%</small></button>
            </div>
            <label className="stl-field">Triangoli: {formatCount(Math.min(target, maxTarget))}{source ? ` (${Math.round(Math.min(target, maxTarget) / maxTarget * 100)}%)` : ''}
              <input type="range" disabled={!source} min={Math.log(MIN_TARGET)} max={Math.log(Math.max(MIN_TARGET + 1, maxTarget))} step={0.01} value={sliderValue}
                onChange={(event) => setTarget(Math.round(Math.exp(Number(event.target.value)) / 1000) * 1000 || MIN_TARGET)} />
            </label>
            <label className="stl-check"><input type="checkbox" checked={prune} disabled={!source} onChange={(event) => setPrune(event.target.checked)} />Rimuovi frammenti isolati (rumore della scansione)</label>
          </section>

          <section aria-disabled={!result}>
            <h2>4 · Punti di aggancio</h2>
            <button className={placing ? 'stl-toggle is-active' : 'stl-toggle'} disabled={!result} onClick={() => setPlacing((value) => !value)}>
              {placing ? 'Fine posizionamento' : '+ Aggiungi punti'}
            </button>
            <p className="stl-hint">{placing ? 'Clicca sul pianale o sul modello per mettere un punto; trascina per ruotare la vista.' : 'Ancoraggi del vano: i prodotti vi si agganciano entro 6 cm.'}</p>
            {anchors.length > 0 && (
              <ul className="stl-anchors">
                {anchors.map((anchor, index) => (
                  <li key={index} className={index === selectedAnchor ? 'is-selected' : ''} onClick={() => setSelectedAnchor(index)}>
                    <div className="stl-row">
                      <input aria-label="Nome del punto" value={anchor.id} onChange={(event) => updateAnchor(index, { id: event.target.value.replace(/\s+/g, '-') })} />
                      <button aria-label={`Elimina ${anchor.id}`} title="Elimina" onClick={(event) => { event.stopPropagation(); removeAnchor(index) }}>✕</button>
                    </div>
                    <div className="stl-coords">
                      {(['X', 'Y', 'Z'] as const).map((axis, k) => (
                        <label key={axis}>{axis}
                          <input type="number" step={0.005} aria-label={`${axis} di ${anchor.id}`} value={anchor.position[k]}
                            onChange={(event) => { const position = [...anchor.position] as Vec3; position[k] = toMm(Number(event.target.value)); updateAnchor(index, { position }) }} />
                        </label>
                      ))}
                    </div>
                    <small>Normale {anchor.normal.join(', ')}</small>
                  </li>
                ))}
              </ul>
            )}
            {anchorIssue && <p className="stl-warning">{anchorIssue}</p>}
            {anchors.length > 0 && <button disabled={!!anchorIssue} onClick={() => void copyAnchors()}>Copia JSON per il manifest</button>}
            {notice && <p className="stl-hint">{notice}</p>}
          </section>

          <section>
            <h2>5 · Risultato</h2>
            {result ? (
              <dl className="stl-stats">
                <dt>Triangoli</dt><dd className={resultTriangles > MAX_TRIANGLES ? 'is-warning' : ''}>{formatCount(resultTriangles)}</dd>
                <dt>Vertici</dt><dd>{formatCount(resultVertices)}</dd>
                <dt>Scostamento max</dt><dd>{(result.error * 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} mm</dd>
                <dt>L × H × P</dt><dd>{result.size.map(formatM).join(' × ')} m</dd>
                <dt>Peso GLB</dt><dd className={bytes > MAX_BYTES ? 'is-warning' : ''}>{formatMb(bytes)}</dd>
              </dl>
            ) : <p className="stl-hint">Carica un STL per vedere il risultato.</p>}
            {tooHeavy && <p className="stl-warning">Supera i limiti del catalogo (200.000 triangoli, 8 MB): riduci il grado di conversione.</p>}
            {result && result.size.some((v) => v > 8 || v < 0.5) && <p className="stl-warning">Ingombro insolito per un furgone: controlla l’unità del file.</p>}
            <label className="stl-field">Codice (nome del file)
              <input value={code} disabled={!result} onChange={(event) => setCode(codeFromName(event.target.value))} />
            </label>
            <button className="stl-primary" disabled={!result || !!busy || !!anchorIssue} onClick={download}>Scarica {code || 'VEICOLO'}.glb{anchors.length ? ` · ${anchors.length} punti` : ''}</button>
            <p className="stl-hint">Per usarlo: copia il file in <code>public/models/</code>, aggiungi il veicolo in <code>catalog/manifest.json</code> e lancia <code>npm run catalog:publish</code>. I punti nel GLB valgono solo se il veicolo non dichiara <code>anchors</code> nel manifest.</p>
          </section>
        </aside>

        <section className="stl-viewport">
          <div className="stl-viewport-bar">
            <span>{busy ?? (placing ? 'Clicca per aggiungere un punto di aggancio' : result ? `${formatCount(resultTriangles)} triangoli` : 'Anteprima')}</span>
            <label className="stl-check"><input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} />Wireframe</label>
          </div>
          {error && <div className="stl-error" role="alert">{error}</div>}
          <div className={`stl-canvas${dragging ? ' is-dragging' : ''}`}>
            {result ? (
              <Canvas camera={{ position: [4, 3, 5], fov: 40, near: 0.01, far: 200 }} style={{ cursor: placing ? 'crosshair' : undefined }}>
                <color attach="background" args={['#e9edf2']} />
                <hemisphereLight args={['#ffffff', '#8a929c', 1.6]} />
                <directionalLight position={[3, 6, 4]} intensity={1.6} />
                <Bounds key={result.size.map((v) => v.toFixed(1)).join()} fit clip margin={1.3}>
                  <Preview result={result} wireframe={wireframe} onPick={placing ? addAnchor : undefined} />
                </Bounds>
                {anchors.map((anchor, index) => <AnchorMarker key={index} anchor={anchor} selected={index === selectedAnchor} onSelect={() => setSelectedAnchor(index)} />)}
                <Grid infiniteGrid cellSize={0.1} sectionSize={1} cellColor="#c8cfd8" sectionColor="#9aa4b1" fadeDistance={30} />
                <OrbitControls makeDefault />
              </Canvas>
            ) : <div className="stl-empty">{busy ?? 'Trascina qui un file .stl'}</div>}
          </div>
        </section>
      </main>
    </div>
  )
}

type Pick = (position: Vec3, normal: Vec3, onFloor: boolean) => void

function Preview({ result, wireframe, onPick }: { result: Result; wireframe: boolean; onPick?: Pick }) {
  const geometry = useMemo(() => {
    const next = new BufferGeometry()
    next.setAttribute('position', new BufferAttribute(result.positions, 3))
    next.setAttribute('normal', new BufferAttribute(result.normals, 3))
    next.setIndex(new BufferAttribute(result.indices, 1))
    next.computeBoundingSphere()
    next.computeBoundingBox()
    return next
  }, [result])
  useEffect(() => () => geometry.dispose(), [geometry])
  const box = geometry.boundingBox ?? new Box3()
  const floorSize = box.getSize(new Vector3())
  const floorCenter = box.getCenter(new Vector3())

  // A click, not the end of an orbit drag; the nearest surface wins.
  const pickMesh = (event: ThreeEvent<MouseEvent>) => {
    if (!onPick || event.delta > 4 || !event.face) return
    event.stopPropagation()
    const normal = event.face.normal.clone()
    if (normal.dot(event.ray.direction) > 0) normal.negate()
    onPick(event.point.toArray(), cleanNormal(normal), false)
  }
  const pickFloor = (event: ThreeEvent<MouseEvent>) => {
    if (!onPick || event.delta > 4) return
    event.stopPropagation()
    onPick([event.point.x, box.min.y, event.point.z], [0, 1, 0], true)
  }
  return (
    <group>
      <mesh geometry={geometry} onClick={pickMesh}>
        <meshStandardMaterial color="#c7cacd" roughness={0.8} side={DoubleSide} wireframe={wireframe} />
      </mesh>
      {/* Floor plane at the lowest point: where floor anchors go when the survey has no floor. */}
      <mesh position={[floorCenter.x, box.min.y + 0.001, floorCenter.z]} rotation={[-Math.PI / 2, 0, 0]} onClick={pickFloor}>
        <planeGeometry args={[floorSize.x, floorSize.z]} />
        <meshStandardMaterial color="#8fa3bf" transparent opacity={0.28} side={DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

function AnchorMarker({ anchor, selected, onSelect }: { anchor: GlbAnchor; selected: boolean; onSelect: () => void }) {
  const color = selected ? '#2f5bd3' : '#ea7a1a'
  const tip = anchor.normal.map((v) => v * 0.12) as Vec3
  const line = useMemo(() => new BufferGeometry().setFromPoints([new Vector3(), new Vector3(...tip)]), [tip[0], tip[1], tip[2]]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => line.dispose(), [line])
  return (
    <group position={anchor.position}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect() }}>
        <sphereGeometry args={[0.025, 20, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      <lineSegments geometry={line} renderOrder={2}>
        <lineBasicMaterial color={color} depthTest={false} />
      </lineSegments>
      <Html position={tip} center className={`stl-anchor-label${selected ? ' is-selected' : ''}`}>{anchor.id}</Html>
    </group>
  )
}
