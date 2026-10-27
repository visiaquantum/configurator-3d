# Configurator 3D

Libreria React 19 e TypeScript per collocare prodotti GLB in un vano, comporre assiemi con connettori dichiarati e produrre JSON, PNG, GLB e distinta PDF. La demo usa il catalogo pilota in `public/models/` e il manifest in `public/catalog/assembly-manifest.json`.

## Sviluppo e verifiche

Usare Node.js 24 e `npm ci`, poi:

```sh
npm run dev
npm run lint
npm test
npm run build:demo
```

`npm test` compila la libreria, esegue i test di regressione con il test runner nativo di Node e i quattro script di verifica degli snap e degli assiemi sui GLB reali. `npm test` controlla anche che il bundle resti entro 60 kB gzip (`npm run check:size`). La CI, su ogni pull request e sui push in `main`, esegue audit delle dipendenze, lint, test, build della demo e la preparazione dell'esempio di integrazione, che viene installato dal pacchetto compilato e verificato con il suo `tsc`. `npm run build:lib` produce soltanto ESM e dichiarazioni in `dist/`; la demo viene compilata separatamente in `dist-demo/`. Entrambe le directory sono generate e ignorate da Git.

`tests/movement.test.mjs` verifica anche i comandi condivisi da mouse, gizmo e Inspector: movimento rigido degli assiemi, annullamento dell'anteprima, agganci e undo. Usa lo store della libreria compilata e carica gli adattatori interni con Vite, senza aprire porte di rete o richiedere WebGL. I test controllano le pose Three.js e il progetto serializzato; gli eventi del browser restano oggetto della verifica manuale.

`tests/commands.test.mjs` verifica senza React né WebGL le regole di dominio estratte dai componenti: mappa delle scorciatoie, comandi dell'Inspector (rotazione, ancoraggio al vano, sgancio, distanza della coppia specchiata, aggiunta di prodotti), opzioni di distanza calcolate dal catalogo e compatibilità dichiarata dal manifest.

`tests/product-metadata.test.mjs` copre la preparazione condivisa dei GLB, le coordinate di collider e snap, la cache per configurazione, l'isolamento tra store e la migrazione dei progetti legacy nei diversi ordini di caricamento. Include i modelli reali YSI12836 e KIT01.

I prodotti usati nella scena vengono caricati per `catalogId`. `scene/productAsset.ts` prepara un modello condiviso senza modificarne la sorgente; `ProductInstances` pubblica dimensioni, snap e regole insieme attraverso `hydrateProduct`, prima di montare le istanze. Ogni istanza mantiene materiali e trasformazioni propri. La telemetria `asset-load` dei prodotti segnala il caricamento per prodotto, anziché per pezzo inserito.

I collegamenti tra pezzi hanno un solo modello, il grafo di `assembly/graph.ts`: ogni giunto lega due punti di snap ed è *risolto* (un `Connection` con i connettori del manifest) oppure *in sospeso* (un `snapToItem` che il manifest non ha ancora confermato: manifest assente, metadati non ancora caricati o connettori non compatibili). Nel progetto in memoria i giunti risolti stanno in `connections` e quelli in sospeso come `snapToItem` sul pezzo sorgente; il `snapToItem` che duplica un giunto risolto esiste solo nel file esportato, per i lettori che conoscono soltanto quel formato. `exportProject()`, `getProject()`, `onChange` e `onSave` restituiscono questa forma persistita; `state.project` è la forma di editing, con ogni giunto una sola volta. Movimento, rotazione, agganci guidati e magnetici, collisioni, validazione e Inspector leggono tutti il grafo tramite `jointsOf` / `selectJoints`.

`assembly/resolveJoints.ts` risolve i giunti in sospeso appena i due prodotti di ciascun giunto hanno snap e regole idratati (anche un array vuoto) e il manifest è disponibile, senza passi di undo. Ogni giunto si risolve da solo: uno non risolvibile resta in sospeso, non viene mai scartato e non blocca gli altri. Con un manifest caricato viene segnalato come errore «Collegamento non riconosciuto dal manifest tecnico», che impedisce la distinta finché non lo si sgancia. Il formato dei file non cambia.

Con il server locale attivo, `/tests/browser/index.html` permette di verificare due canvas indipendenti, scale del vano diverse, sola lettura, undo e recupero dopo un errore GLB. Il pulsante “Genera PDF” mostra il risultato dell'API di esportazione. Questo controllo è manuale e non fa parte della CI.

Il pacchetto è `UNLICENSED`, pubblicato come restricted sul registry npm di GitHub. Non contiene i modelli del cliente né l'HDR della demo. Non occorrono credenziali di pubblicazione per modificare o verificare il codice locale.

## Aggancio visuale e controlli

Il click sinistro seleziona un componente e apre le proprietà compatte. Per unirlo a un altro pezzo usare il tasto destro → **Aggancia nella scena**, oppure il pulsante nell'Inspector:

1. Cliccare uno snap azzurro sul componente di partenza.
2. Passare sui pezzi compatibili, che si evidenziano in azzurro, e cliccare il destinatario.
3. Passare su uno snap del destinatario per vedere l'anteprima verde o rossa; cliccare per confermare un aggancio valido.

Il pannello mostra il nome del punto e il motivo di un eventuale rifiuto. **Indietro** cambia la scelta; **Esc** annulla senza modificare il progetto. Gli elenchi espandibili di punti e destinatari consentono le stesse operazioni da tastiera. La vista resta orbitabile. Durante l'aggancio il vano diventa trasparente, poi torna all'impostazione precedente; esportazione, gizmo e trascinamento dei pezzi sono sospesi.

L'anteprima considera l'intero assieme, i punti occupati, i connettori, gli item bloccati e le collisioni. La conferma crea un solo passo di undo. È possibile comporre un assieme temporaneamente fuori dal vano e poi ruotarlo o spostarlo: il messaggio di ingombro resta visibile e blocca la distinta PDF finché non viene risolto.

Le sessioni di aggancio sono locali allo store e non entrano nel JSON. Per pannelli host sono disponibili `beginAttachment(store, itemId)`, `chooseAttachmentPoint`, `chooseAttachmentTarget` e `backAttachment`; `store.getState().setAttachment(null)` annulla la sessione. Un eventuale `label` nei punti `catalog.snapPoints` fornisce un nome leggibile senza cambiare l'ID persistente.

Il menu **Esporta** raccoglie PNG, GLB e PDF. La demo offre ricerca e filtro di compatibilità nel catalogo, un elenco dei pezzi presenti e strumenti di progetto separati dai controlli quotidiani.

L'interfaccia usa pannelli chiari o scuri, una scena neutra e accenti blu per le azioni principali. Le anteprime statiche in `public/catalog/previews/` provengono dai GLB del catalogo: non aggiungono canvas WebGL alla sidebar. La pagina locale `/scripts/catalog-previews.html` permette di rigenerarle mantenendo la stessa camera e illuminazione; mostra solo i corpi dei prodotti, con una finitura neutra per rendere leggibile la geometria. Le anteprime non modificano i materiali della scena né dei file esportati.

Il selettore **Chiaro / Scuro** nella testata della demo aggiorna interfaccia, sfondo della scena e griglia senza azzerare il progetto. La scelta viene ricordata nel browser; al primo avvio si usa la preferenza del sistema. Con storage disabilitato il selettore continua a funzionare per la sessione corrente. Nella libreria il tema è controllato dall'host tramite `<Configurator3D theme="light" />` o `theme="dark"` (default `light`), con palette indipendenti per ciascuna istanza. Il tema non viene scritto nel JSON di progetto e non cambia le luci o i materiali dei prodotti.

## Integrazione

Un progetto React indipendente, con libreria installata da pacchetto, catalogo JSON,
quattro GLB, manifest e un assieme completo è disponibile in
[examples/react-integration](examples/react-integration/README.md).
Eseguire `npm run example:prepare`, poi seguire le istruzioni dell'esempio.

```tsx
import { useRef } from 'react'
import { Configurator3D } from '@visiaquantum/configurator-3d'
import type { ConfiguratorHandle } from '@visiaquantum/configurator-3d'

const enclosure = { glbUrl: '/van.glb', scale: 1, dimensions: [3.4, 1.8, 1.8] as [number, number, number] }
const catalog = [{ id: 'shelf', label: 'Ripiano', glbUrl: '/shelf.glb', size: [1, 0.07, 0.35] as [number, number, number] }]

export function Editor() {
  const ref = useRef<ConfiguratorHandle>(null)
  return (
    <div style={{ width: '100%', height: 700 }}>
      <Configurator3D
        ref={ref}
        enclosure={enclosure}
        catalog={catalog}
        assemblyManifest="/assembly-manifest.json"
        onChange={(project) => console.log(project)}
      />
    </div>
  )
}
```

Il pacchetto è distribuito soltanto come modulo ES. Le dipendenze `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`, `zod` e `nanoid` vanno installate dall'host; le versioni supportate sono quelle dichiarate in `peerDependencies` (`three` fino a 0.184, finché non viene verificata una versione successiva). `jspdf` è facoltativa: serve solo per `exportPDF`, che senza di essa restituisce un errore esplicito. Per i tipi TypeScript installare anche `@types/three`.

| Prop | Default | Uso |
| --- | --- | --- |
| `enclosure` | — (obbligatoria) | URL del GLB del vano oppure `EnclosureData` con `scale`, `dimensions`, `anchors`. |
| `catalog` | — | Array di prodotti oppure URL di un catalogo JSON. |
| `assemblyManifest` | — | Manifest tecnico inline oppure URL; senza manifest la validazione tecnica e la distinta non sono disponibili. |
| `initialItems`, `projectId`, `metadata` | — | Dati iniziali del progetto; riferimenti stabili, un cambiamento ricrea il progetto. |
| `store` | store proprio | Store esplicito per collegare pannelli esterni. |
| `readOnly` | `false` | Blocca modifiche, undo e redo. |
| `theme` | `light` | Palette `light` o `dark` di pannelli e scena. |
| `environmentUrl` | ambiente procedurale | HDR per i riflessi; `null` li disattiva. |
| `showInspector`, `showToolbar`, `showHints` | `true` | Mostrano proprietà del pezzo, barra Salva/Esporta e barra Sposta/Ruota/undo. |
| `onChange`, `onSave` | — | Ricevono il progetto nella forma persistita. |
| `onValidationChange` | — | Riceve il report di validazione a ogni cambiamento e al montaggio. |
| `onCatalogLoaded`, `onCatalogError` | — | Esito del caricamento di un catalogo remoto. |
| `onTelemetry` | — | Eventi locali di caricamento, export, validazione e tempo di frame. |
| `className`, `style` | — | Applicati al contenitore. |
| `ref` | — | Handle imperativo `ConfiguratorHandle` (`addItem`, `setProject`, `getProject`, export, undo/redo). |

Ogni configuratore crea uno store e un registro degli oggetti indipendenti. Per collegare un pannello esterno usare uno store esplicito e il provider:

```tsx
import { createConfiguratorStore, ConfiguratorStoreProvider, Configurator3D, useConfiguratorStore } from '@visiaquantum/configurator-3d'

const store = createConfiguratorStore()

function Counter() {
  const count = useConfiguratorStore((state) => state.project?.items.length ?? 0)
  return <span>{count} componenti</span>
}

export function Workspace() {
  return (
    <ConfiguratorStoreProvider store={store}>
      <Counter />
      <div style={{ height: 700 }}><Configurator3D enclosure={enclosure} catalog={catalog} /></div>
    </ConfiguratorStoreProvider>
  )
}

// Comandi esterni al rendering React:
store.getState().undo()
```

È anche possibile passare `store={store}` al componente. Il provider deve racchiudere i pannelli che leggono quello store; non condividere lo stesso store tra due canvas attivi. `useConfiguratorStoreApi()` restituisce lo store del provider corrente. Le vecchie proprietà statiche `useConfiguratorStore.getState()` si riferiscono soltanto allo store standalone legacy: sostituirle con `store.getState()` o con il nuovo hook quando si integra un canvas.

Gli oggetti `enclosure`, `initialItems` e `metadata` devono avere riferimenti stabili: un cambiamento dei dati iniziali ricrea il progetto e azzera la cronologia. Per cambiare il progetto durante una sessione usare `ref.current.setProject(project)`. Il reset dello stesso GLB conserva i limiti e gli anchor già estratti. Un cambio di URL, scala o dimensioni ricalcola i dati del vano.

`getProject()` (handle), `store.getState().exportProject()` e `onChange` forniscono copie dei dati, per evitare modifiche accidentali dello stato o della cronologia da parte dell'host. `readOnly` impedisce modifiche, undo e redo; i caricamenti e la validazione continuano. Gli item `locked` e i vincoli `lockAxis` sono rispettati dai comandi dello store. Un assieme che contiene un item bloccato o con assi vincolati è fisso per gesti, gizmo, aggancio guidato e Inspector; i comandi dello store possono ancora modificare le coordinate non vincolate.

Le posizioni risolte degli agganci al vano vengono sincronizzate nel progetto esportato senza aggiungere passi alla cronologia. Spostare un pezzo libera il vecchio anchor; un nuovo aggancio deve essere dichiarato esplicitamente nel comando.

## Architettura

I componenti React presentano lo stato e collegano gli eventi; le decisioni stanno in moduli verificabili senza montare React.

| Modulo | Responsabilità |
| --- | --- |
| `assembly/graph.ts` | Grafo dei giunti: lettura, scrittura, vicini, membri di un assieme, adattatori di import/export di `snapToItem`. |
| `assembly/manifest.ts`, `assembly/resolveJoints.ts` | Connettori del manifest, compatibilità, scoperta dei giunti a una posa, risoluzione dei giunti in sospeso. |
| `assembly/validation.ts`, `assembly/pairSpacing.ts` | Validazione geometrica e tecnica; distanze proponibili per una coppia specchiata. |
| `state/projectSlice.ts` | Progetto persistente e cronologia: l'unica parte che undo/redo attraversa. |
| `state/resourceSlice.ts` | Catalogo, manifest, metadati dei prodotti, limiti del vano, errori degli asset e riferimenti Three.js. |
| `state/interactionSlice.ts`, `state/reset.ts` | Selezione, aggancio in corso, gesti, preferenze di vista, cache derivate, e cosa azzera ogni tipo di cambiamento. |
| `state/selectors.ts` | Dati derivati per snapshot del progetto (grafo, pezzi fissi, anchor effettivi); da usare con `useShallow` nei pannelli. |
| `scene/commands.ts`, `scene/itemMovement.ts`, `scene/connectionPreview.ts`, `scene/attachment.ts` | Comandi di editing condivisi da Inspector, tastiera, handle imperativo, mouse e gizmo. |
| `scene/liveDrag.ts` | Anteprima durante il gesto sui gruppi Three.js live; non salva nulla. |
| `scene/Item.tsx`, `ui/*`, `Configurator3D.tsx` | Rendering, eventi e ciclo di vita React. |

Lo store di ogni configuratore compone le tre slice in un unico stato, così un comando aggiorna progetto, interazione e cache in una sola notifica. Cronologia, file esportato e `onChange` contengono soltanto il progetto: selezione, anteprime, caricamenti e riferimenti Three.js non creano passi di undo. Le correzioni dovute al caricamento (posizione risolta dall'anchor, riposizionamento dentro il vano appena i limiti sono noti) aggiornano il progetto senza aggiungere passi.

### Aggiungere un prodotto o una regola

1. Aggiungere il GLB e la voce di catalogo (`id`, `glbUrl`, `size`, eventuali `snapPoints` certificati e `autoSnapGrid`). Gli snap possono anche essere nodi `SNAP_<TIPO>` del GLB, le regole nodi `RULE_*` o extras (vedi [docs/glb-conventions.md](docs/glb-conventions.md)).
2. Dichiarare nel manifest i connettori del prodotto (`snapId` o `snapKind`), `compatibleWith`, capacità, tolleranze, clearance, collider e componenti di distinta. Quando un connettore dichiara `compatibleWith`, è il manifest a decidere la compatibilità: un nuovo tipo di punto non richiede modifiche al codice.
3. Senza manifest la compatibilità deriva dalla tabella dei tipi `MATING_RULES` in `scene/mating.ts`, che riflette le convenzioni dei GLB esistenti; i tipi che non si accoppiano con nulla (ad esempio `origine`) non vengono proposti.
4. Una regola parametrica nuova (oltre a `mirror-pair` e `auto-snap-grid`) richiede invece una funzione pura in `scene/` o `assembly/`, un comando in `scene/commands.ts` e i relativi test; i componenti si limitano a mostrarne le opzioni.

## Coordinate e dati tecnici

- L'asse verticale è Y; posizioni e lunghezze runtime sono in metri; gli Euler XYZ sono in radianti.
- `catalog.size`, i collider, gli offset e le dimensioni delle clearance e `insertionDepth` del manifest sono espressi nelle unità del prodotto e moltiplicati una sola volta per `catalog.scale`.
- `PlacedItem.position` è il riferimento di base: il centro del collider si trova a `position.y + bodyHeight / 2`. La sua rotazione è applicata attorno al centro.
- Gli snap dichiarati in `catalog.snapPoints` sono già in metri, nel frame centrato del collider. Gli snap estratti dal GLB vengono scalati e trasformati in questo frame durante il caricamento.
- Le dimensioni idratate del corpo stabiliscono il riferimento degli snap anche quando il manifest contiene piccoli collider locali. I centri dei collider e gli offset delle clearance vengono riflessi per gli item specchiati.
- Tolleranze di aggancio e distanze delle regole mirror-pair sono in metri. L'aggancio usa la tolleranza più restrittiva dei due connettori e controlla che le normali, quando disponibili, siano opposte.
- `enclosure.dimensions`, quando presente, definisce un volume interno in metri, centrato su X/Z con base Y=0. In alternativa vengono letti `Body_interior` o i limiti dedicati del vano pilota. Senza limiti interni la validazione segnala che l'ingombro richiede verifica.

I collider sono AABB conservative dei box ruotati: non sostituiscono una verifica CAD delle superfici reali. La validazione verifica connettori, capacità, tolleranze, cicli, collider e clearance dichiarati nel manifest. La qualità dei dati tecnici resta necessaria per un risultato affidabile.

Gli snap certificati dal catalogo sostituiscono i marker GLB dello stesso tipo. I fori automatici richiedono contorni chiusi interni a una superficie; piccoli poligoni pieni e sottoalberi nascosti non vengono trattati come fori. Il rilevamento viene memorizzato per GLB, scala e regola, così più istanze riutilizzano il risultato.

Convenzioni dei modelli: [docs/glb-conventions.md](docs/glb-conventions.md).

## Importazione, migrazione ed esportazione

`parseProject` accetta un oggetto o JSON, migra la versione legacy 0 alla versione 1 e rifiuta versioni future o malformate, ID duplicati, riferimenti a item mancanti, scale e dimensioni non positive e vincoli incompleti. I cataloghi e i manifest supportano la versione 1 e vengono validati anche quando passati inline. URL remoti e asset vengono caricati con gestione degli errori; le richieste dei dati vengono annullate quando cambia la sorgente o il componente viene smontato.

I vecchi `snapToItem` vengono convertiti giunto per giunto, appena sono caricati gli snap e le regole dei due prodotti coinvolti. Un collegamento non risolvibile resta in sospeso, viene segnalato e impedisce l'esportazione tecnica. Gli ID dei fori derivati dalla geometria possono cambiare quando si modifica un GLB o si corregge il rilevamento: per progetti persistenti preferire snap certificati con ID espliciti. I vecchi agganci basati su falsi fori devono essere corretti.

L'API espone `addItem`, `removeItem`, `selectItem`, `setProject`, `undo`, `redo`, `getProject`, `getValidation`, `exportPNG`, `exportGLB` e `exportPDF`.

PNG e GLB richiedono modelli caricati senza errori. PDF/BOM richiedono anche un manifest completo e l'assenza di errori bloccanti; la geometria viene ricontrollata al momento dell'esportazione. Il caricamento non viene mostrato come una configurazione valida. Le esportazioni sullo stesso store vengono eseguite in sequenza e ripristinano la selezione. Se il progetto cambia durante l'operazione, l'esportazione viene rifiutata e può essere ripetuta.

Il GLB contiene le geometrie esportabili, esclude wireframe e marker dell'interfaccia, conserva i transform mondiali e non modifica materiali o oggetti live. Il PDF divide descrizioni lunghe e tabelle su più pagine, ripetendo l'intestazione. L'helper `exportProjectPDF` usato direttamente produce un documento con stato “verifica tecnica non eseguita”: il chiamante può indicare `validated: true` solo dopo aver verificato asset, manifest e geometria correnti.

La scena usa un ambiente procedurale locale a bassa risoluzione con illuminazione diffusa e pannelli di riflessione su tutti i lati. Passare `environmentUrl` per un HDR servito dall'host oppure `null` per disabilitare i riflessi; le luci dirette restano attive. La demo passa esplicitamente il proprio HDR locale. Nessun URL `/hdr/...` viene richiesto implicitamente dalla libreria. `onTelemetry` è facoltativo e locale: l'host decide se e dove inviare gli eventi.
