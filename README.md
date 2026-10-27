# Configurator 3D

Componente React per comporre prodotti 3D (GLB) dentro un vano — furgone, armadio, scaffale — e salvarne la configurazione come JSON, con esportazione PNG, GLB e distinta PDF.

## Installazione

Il pacchetto non è pubblicato su npm pubblico. Generarlo da questo repository:

```sh
npm ci
npm run build:lib
npm pack              # crea configurator-3d-<versione>.tgz
```

Nel progetto host, copiare il `.tgz` (ad esempio in `vendor/`) e installarlo insieme alle dipendenze:

```sh
npm install ./vendor/configurator-3d-0.1.0.tgz react react-dom three @react-three/fiber @react-three/drei zustand zod nanoid
npm install jspdf          # facoltativo, solo per l'export PDF
npm install -D @types/three
```

Requisiti: React 19, `three` da 0.180 a 0.184. Il pacchetto è solo ESM e include già i suoi stili.

In alternativa si può pubblicare su un registry npm privato: rimuovere `"private": true` da `package.json`, rinominarlo con uno scope proprio (es. `@azienda/configurator-3d`) e aggiungere `publishConfig.registry`. Lo scope evita che `npm install` scarichi per errore un omonimo pubblico.

## Uso minimo

```tsx
import { useRef } from 'react'
import { Configurator3D } from 'configurator-3d'
import type { ConfiguratorHandle, ProjectData } from 'configurator-3d'

// Fuori dal componente (o in useMemo): un nuovo riferimento ricrea il progetto.
const enclosure = { glbUrl: '/models/furgone.glb', dimensions: [3.4, 1.8, 1.8] as [number, number, number] }

export function Editor() {
  const ref = useRef<ConfiguratorHandle>(null)

  return (
    <div style={{ width: '100%', height: 700 }}>
      <Configurator3D
        ref={ref}
        enclosure={enclosure}
        catalog="/catalog/catalog.json"
        assemblyManifest="/catalog/assembly-manifest.json"
        onSave={(project: ProjectData) => saveToBackend(project)}
      />
    </div>
  )
}
```

Il contenitore deve avere un'altezza esplicita. Unità in metri, asse verticale Y, rotazioni in radianti.

## Dati da fornire

| Dato | Cosa contiene |
| --- | --- |
| **Vano** (`enclosure`) | URL del GLB, oppure `{ glbUrl, scale?, dimensions?, anchors? }`. `dimensions` delimita lo spazio utile. |
| **Catalogo** (`catalog`) | Prodotti `{ id, label, glbUrl, size?, scale?, snapPoints? }`, come array o URL di un JSON. |
| **Manifest** (`assemblyManifest`) | Connettori, compatibilità, collider e codici di distinta. Facoltativo, ma senza manifest non c'è validazione tecnica né PDF. |

Esempio di catalogo:

```json
{
  "version": 1,
  "items": [
    {
      "id": "ripiano-100",
      "label": "Ripiano 100 cm",
      "glbUrl": "/models/ripiano-100.glb",
      "size": [1.0, 0.07, 0.36],
      "snapPoints": [
        { "id": "end-a", "kind": "laterale", "position": [-0.5, 0, 0], "normal": [-1, 0, 0] }
      ]
    }
  ]
}
```

Formati completi di catalogo, manifest e progetto: [examples/react-integration/public/catalog](examples/react-integration/public/catalog). Convenzioni per preparare i GLB (anchor, snap, regole): [docs/glb-conventions.md](docs/glb-conventions.md).

## Props principali

| Prop | Default | |
| --- | --- | --- |
| `enclosure` | obbligatoria | Vano: URL o oggetto. |
| `catalog` | — | Prodotti disponibili. |
| `assemblyManifest` | — | Regole di montaggio e distinta. |
| `initialItems` | `[]` | Pezzi già presenti all'apertura. |
| `readOnly` | `false` | Solo visualizzazione. |
| `theme` | `'light'` | `'light'` o `'dark'`. |
| `showInspector`, `showToolbar`, `showHints` | `true` | Pannelli integrati. |
| `onChange` | — | Progetto aggiornato a ogni modifica. |
| `onSave` | — | Click su **Salva** nella toolbar. |
| `onValidationChange` | — | Errori e avvisi di montaggio. |

Elenco completo con commenti: tipo `Configurator3DProps` in [src/lib/types.ts](src/lib/types.ts).

## Controllare il configuratore dalla pagina

Il `ref` espone `ConfiguratorHandle`:

```ts
ref.current.addItem(product)          // aggiunge un prodotto del catalogo, restituisce l'id
ref.current.removeItem(id)
ref.current.getProject()              // ProjectData da salvare
ref.current.setProject(project)       // apre un progetto salvato
ref.current.undo() / redo()
ref.current.getValidation()
await ref.current.exportPNG()         // Blob
await ref.current.exportGLB()         // Blob
await ref.current.exportPDF()         // Blob, richiede manifest e jspdf
```

## Salvare e riaprire un progetto

```ts
import { serializeProject, parseProject } from 'configurator-3d'

// Salvataggio
await fetch('/api/progetti/42', { method: 'PUT', body: serializeProject(ref.current!.getProject()!) })

// Apertura: valida e migra i file di versioni precedenti
const json = await fetch('/api/progetti/42').then((r) => r.text())
const { project, warnings } = parseProject(json, { catalog })
ref.current!.setProject(project)
```

`parseProject` lancia `ProjectParseError` se il file non è valido; `warnings` segnala riferimenti mancanti (prodotti fuori catalogo, anchor non dichiarati).

## Pannelli personalizzati

Per leggere lo stato da componenti propri, condividere uno store:

```tsx
import { createConfiguratorStore, ConfiguratorStoreProvider, Configurator3D, useConfiguratorStore } from 'configurator-3d'

const store = createConfiguratorStore()

function Counter() {
  const count = useConfiguratorStore((s) => s.project?.items.length ?? 0)
  return <span>{count} componenti</span>
}

export function Workspace() {
  return (
    <ConfiguratorStoreProvider store={store}>
      <Counter />
      <Configurator3D store={store} enclosure={enclosure} catalog={catalog} />
    </ConfiguratorStoreProvider>
  )
}
```

Ogni `Configurator3D` ha uno store isolato: più istanze nella stessa pagina non si influenzano. Non condividere uno store tra due canvas.

## Note

- **Riferimenti stabili**: `enclosure`, `initialItems` e `metadata` vanno definiti fuori dal render o memoizzati; un nuovo oggetto ricrea il progetto e azzera l'undo.
- **Asset su CDN**: usare URL HTTPS completi e abilitare CORS per il dominio del sito.
- **Export**: PNG e GLB richiedono che i modelli siano caricati; il PDF richiede anche un manifest e nessun errore bloccante.
- **Riflessi**: di default un ambiente procedurale locale; `environmentUrl` accetta un HDR, `null` li disattiva.
- **Testi**: l'interfaccia è in italiano. Ogni `ValidationIssue` ha un `reason` stabile e dei `params` per tradurre i messaggi.

## Esempio completo

[examples/react-integration](examples/react-integration/README.md) è un'app React + Vite indipendente con catalogo, manifest, quattro GLB, salvataggio e import/export JSON.

Per lavorare sul codice della libreria: [docs/development.md](docs/development.md).
