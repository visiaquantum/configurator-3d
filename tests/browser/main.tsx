import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Vector3 } from 'three'
import { Configurator3D, ConfiguratorStoreProvider, createConfiguratorStore, configurationStatus, useConfiguratorStore } from '../../src/lib'
import type { CatalogItem, ConfiguratorHandle } from '../../src/lib'

const stores = [createConfiguratorStore(), createConfiguratorStore()]
const enclosure = { glbUrl: '/models/FIAT-NDC40H2.glb', scale: 10 }
const halfScaleEnclosure = { ...enclosure, scale: 5 }
const product: CatalogItem = { id: 'upright', label: 'Montante di prova', glbUrl: '/models/MONTANTI/YSI12836.glb', size: [0.36, 1.008, 0.03] }
const validCatalog = [product]
const brokenCatalog = [{ ...product, glbUrl: '/missing-model.glb' }]
const manifest = { version: 1, products: [{ catalogId: 'upright', connectors: [] }] }

export function TestScene({ index }: { index: number }) {
  const ref = useRef<ConfiguratorHandle>(null)
  const [readonly, setReadonly] = useState(false)
  const [broken, setBroken] = useState(false)
  const [changes, setChanges] = useState(0)
  const [pdf, setPdf] = useState<{ url: string; size: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraCheck, setCameraCheck] = useState<string | null>(null)
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url) }, [pdf])
  const generatePdf = async () => {
    try {
      const blob = await ref.current?.exportPDF()
      if (blob) setPdf({ url: URL.createObjectURL(blob), size: blob.size })
    } catch (cause) { setError((cause as Error).message) }
  }
  const state = useConfiguratorStore((s) => s)
  const status = configurationStatus(state)
  const checkIsometricCamera = () => {
    const camera = state.captureRefs?.camera
    const bbox = state.enclosureBBox
    if (!camera || !bbox || !('isOrthographicCamera' in camera)) {
      setCameraCheck('FAIL: camera ortografica non attiva')
      return
    }
    camera.updateMatrixWorld()
    const direction = camera.getWorldDirection(new Vector3())
    const axes = direction.toArray().map(Math.abs)
    const equalAxes = Math.max(...axes) - Math.min(...axes) < 1e-6
    let framed = true
    for (const x of [bbox.min[0], bbox.max[0]]) {
      for (const y of [bbox.min[1], bbox.max[1]]) {
        for (const z of [bbox.min[2], bbox.max[2]]) {
          const point = new Vector3(x, y, z).project(camera)
          if (Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) > 1) framed = false
        }
      }
    }
    setCameraCheck(`${equalAxes && framed ? 'PASS' : 'FAIL'}: assi uguali=${equalAxes}; vano inquadrato=${framed}; direzione=${direction.toArray().map((v) => v.toFixed(3)).join(',')}`)
  }
  return (
    <section style={{ width: '50%' }} aria-label={`Scena ${index + 1}`}>
      <h2>Scena {index + 1}</h2>
      <button disabled={readonly} onClick={() => ref.current?.addItem(product)}>Aggiungi {index + 1}</button>
      <button onClick={() => setReadonly((value) => !value)}>Sola lettura {index + 1}: {String(readonly)}</button>
      <button onClick={() => setBroken((value) => !value)}>Modello {index + 1}: {broken ? 'rotto' : 'valido'}</button>
      <button onClick={() => ref.current?.undo()}>Undo {index + 1}</button>
      <button onClick={generatePdf}>Genera PDF {index + 1}</button>
      <button onClick={checkIsometricCamera}>Verifica isometria {index + 1}</button>
      {cameraCheck && <p>{cameraCheck}</p>}
      {pdf && <a href={pdf.url} download={`integration-${index + 1}.pdf`}>Scarica PDF {index + 1} ({pdf.size} byte)</a>}
      {error && <p role="alert">{error}</p>}
      <p>Componenti: {state.project?.items.length ?? 0}; cambiamenti: {changes}; registro: {state.itemRegistry.size}</p>
      <p>Stato: {status.message}; pronto: {String(status.ready)}</p>
      <p>Scala vano: {state.project?.enclosure.scale}; altezza: {state.enclosureBBox ? (state.enclosureBBox.max[1] - state.enclosureBBox.min[1]).toFixed(3) : 'caricamento'}</p>
      <p>Camera: {state.cameraProjection}; richiesta: {state.cameraPreset ?? 'applicata'}; attiva: {state.captureRefs?.camera.type ?? 'caricamento'}</p>
      <div style={{ height: 500 }}>
        <Configurator3D
          ref={ref}
          enclosure={index === 0 ? enclosure : halfScaleEnclosure}
          catalog={broken ? brokenCatalog : validCatalog}
          assemblyManifest={manifest}
          readOnly={readonly}
          onChange={() => setChanges((value) => value + 1)}
          showInspector={false}
        />
      </div>
    </section>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><div style={{ display: 'flex' }}>
    {stores.map((store, index) => <ConfiguratorStoreProvider key={index} store={store}><TestScene index={index} /></ConfiguratorStoreProvider>)}
  </div></StrictMode>,
)
