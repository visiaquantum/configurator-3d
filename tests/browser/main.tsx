import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Configurator3D, ConfiguratorStoreProvider, createConfiguratorStore, configurationStatus, useConfiguratorStore } from '../../src/lib'
import type { CatalogItem, ConfiguratorHandle } from '../../src/lib'

const stores = [createConfiguratorStore(), createConfiguratorStore()]
const enclosure = { glbUrl: '/models/FIAT-NDC40H2.glb', scale: 10 }
const product: CatalogItem = { id: 'upright', label: 'Montante di prova', glbUrl: '/models/MONTANTI/YSI12836.glb', size: [0.36, 1.008, 0.03] }
const validCatalog = [product]
const brokenCatalog = [{ ...product, glbUrl: '/missing-model.glb' }]
const manifest = { version: 1, products: [{ catalogId: 'upright', connectors: [] }] }

function TestScene({ index }: { index: number }) {
  const ref = useRef<ConfiguratorHandle>(null)
  const [readonly, setReadonly] = useState(false)
  const [broken, setBroken] = useState(false)
  const [changes, setChanges] = useState(0)
  const state = useConfiguratorStore((s) => s)
  const status = configurationStatus(state)
  return (
    <section style={{ width: '50%' }} aria-label={`Scena ${index + 1}`}>
      <h2>Scena {index + 1}</h2>
      <button onClick={() => ref.current?.addItem(product)}>Aggiungi {index + 1}</button>
      <button onClick={() => setReadonly((value) => !value)}>Sola lettura {index + 1}: {String(readonly)}</button>
      <button onClick={() => setBroken((value) => !value)}>Modello {index + 1}: {broken ? 'rotto' : 'valido'}</button>
      <button onClick={() => ref.current?.undo()}>Undo {index + 1}</button>
      <p>Componenti: {state.project?.items.length ?? 0}; cambiamenti: {changes}; registro: {state.itemRegistry.size}</p>
      <p>Stato: {status.message}; pronto: {String(status.ready)}</p>
      <p>Scala vano: {state.project?.enclosure.scale}; altezza: {state.enclosureBBox ? (state.enclosureBBox.max[1] - state.enclosureBBox.min[1]).toFixed(3) : 'caricamento'}</p>
      <div style={{ height: 500 }}>
        <Configurator3D
          ref={ref}
          enclosure={enclosure}
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
