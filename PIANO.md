# Piano di semplificazione — tre passi finali

## Stato di partenza

I passi 1–4 sono completati: test dei comandi di movimento, aggiornamenti atomici del progetto, logica condivisa tra mouse/gizmo/Inspector e preparazione dei metadati per prodotto.

La migrazione legacy era già centralizzata nello store e attendeva metadati completi. Rimaneva però la doppia rappresentazione dei collegamenti tramite `connections` e vincoli `snapToItem`.

Questo documento descrive il lavoro dei passi finali, eseguiti nell'ordine **5 → 6 → 7**, ciascuno verificato prima del successivo.

## Passo 5 — Unificare i collegamenti

**Obiettivo:** avere una sola fonte di verità per i collegamenti tra pezzi durante l'editing, mantenendo leggibili i progetti esistenti.

### Attività

- [x] Definire il modello interno del grafo e distinguere un grafo vuoto da un progetto legacy ancora da risolvere. `assembly/graph.ts`: un `Joint` è risolto (un `Connection`) o in sospeso (un `snapToItem` non ancora confermato dal manifest). Grafo vuoto = nessun giunto (`jointsOf`); progetto da risolvere = giunti in sospeso (`pendingJoints`), indipendentemente dalla presenza di `connections`.
- [x] Definire il comportamento in assenza di manifest o metadati: i giunti in sospeso restano tali, non vengono mai scartati né bloccano gli altri. `assembly/resolveJoints.ts` li risolve uno per uno appena i due prodotti hanno snap e regole idratati; quelli non risolvibili vengono segnalati dalla validazione quando c'è un manifest.
- [x] Centralizzare le operazioni sul grafo: `withJoints` (scrittura), `jointsOf`, `jointPartners`, `assemblyMembers`, `jointsSurvivingMove`, `jointsWithout`, `pointUse`, `dedupeJoints`.
- [x] Portare movimento, rotazione, aggancio guidato, aggancio magnetico, collisioni e validazione a leggere lo stesso modello. `itemMovement`, `connectionPreview`, `assemblyPlacement`, `attachment`, `Item`, `Inspector`, `validation` usano `jointsOf` / `selectJoints`; le funzioni pubbliche `linkedPartners` e `assemblyGroup` delegano al grafo.
- [x] Eliminare la sincronizzazione continua tra `connections` e `snapToItem` dal nucleo dell'editing. `reconcileConstraints` e `resolveLegacyProject` sono stati rimossi; nello store ogni giunto compare una volta. `toEditableProject` (import) e `toPersistedProject` (`exportProject`, `getProject`, `onChange`, `onSave`) sono gli unici adattatori; `commitAssembly` resta come adattatore pubblico che conserva i giunti in sospeso, `commitJoints` scrive il grafo intero.
- [x] Conservare il comportamento delle coppie specchiate e degli ancoraggi al vano: la coppia resta un vincolo `mirrorPair` (seguita da `assemblyMembers` ma fuori dal grafo), l'ancoraggio resta `snapToAnchor`.
- [x] Verificare importazione, esportazione e undo/redo con progetti legacy, moderni e assiemi con più giunti per pezzo (`tests/regressions.test.mjs`, `tests/product-metadata.test.mjs`).

**Criteri di completamento:** ogni operazione sull'assieme consulta un'unica rappresentazione; nessuna modifica richiede di mantenere manualmente due strutture parallele; nessuna migrazione parziale viene salvata; i progetti esistenti mantengono i collegamenti.

## Passo 6 — Separare lo stato per responsabilità

**Obiettivo:** rendere esplicito cosa viene salvato, cosa appartiene all'interazione corrente e cosa serve al rendering.

### Attività

- [x] Classificare i campi dello store in progetto persistente, interazioni temporanee, risorse della scena e dati derivati (`state/storeTypes.ts`: `ProjectState`, `InteractionState`, `SceneResources`, `DerivedState`).
- [x] Separare tipi, azioni e selettori in moduli dedicati: `projectSlice`, `resourceSlice`, `interactionSlice`, `selectors`; `store.ts` è il solo punto di composizione, con un unico stato per aggiornamenti atomici.
- [x] Concentrare la cronologia sulle modifiche persistenti del progetto. Il riposizionamento dentro il vano al caricamento usa `settleItemPosition` invece di un passo di undo; selezione, anteprime, caricamenti e riferimenti Three.js non toccano `past`/`future`.
- [x] Definire esplicitamente il reset delle interazioni e delle risorse (`state/reset.ts`): cambio di progetto, di vano, di catalogo, sola lettura, undo/redo, chiusura dell'aggancio.
- [x] Ridurre le sottoscrizioni ampie: Inspector, Toolbar, pannello di validazione e overlay di aggancio usano selettori stretti con `useShallow`; ogni `Item` legge un solo booleano (`selectCanMove`) calcolato una volta per snapshot.
- [x] Eliminare lo stato duplicato: `overlappingIds` è derivato insieme a `validationIssues` (rimosso `OverlapDetector`), lo stato del catalogo viene dallo store, gli anchor effettivi da un solo selettore, `assetEpoch` (mai letto) è stato rimosso. `validationIssues` resta come cache perché la validazione è costosa.
- [x] Conservare l'API pubblica esistente mediante adattatori e verificare l'isolamento tra più configuratori (test di regressione e `tests/browser/index.html`).

**Criteri di completamento:** ogni campo ha una responsabilità chiara; dati temporanei e oggetti della scena non entrano nel progetto esportato o nella cronologia; i comandi restano atomici; due configuratori non condividono stato modificabile.

## Passo 7 — Alleggerire i componenti e isolare le regole dei prodotti

**Obiettivo:** lasciare ai componenti React la presentazione e il collegamento degli eventi, rendendo le decisioni di dominio verificabili separatamente.

### Attività

- [x] Esaminare la logica rimasta in `Item`, `Configurator3D` e `Inspector`, distinguendo rendering, gestione degli eventi e decisioni di dominio.
- [x] Estrarre le decisioni residue: `scene/commands.ts` (aggiunta, ancoraggio, sgancio, distanza della coppia), `assembly/pairSpacing.ts`, `scene/liveDrag.ts`, `scene/itemMaterials.ts`, `state/shortcuts.ts`, `io/sceneExport.ts`; restano hook solo `useValidationReport` e `useSceneTools`. Righe: `Item` 829 → 529, `Inspector` 212 → 70, `Configurator3D` 865 → 280.
- [x] Far convergere le azioni equivalenti: la rotazione dell'Inspector usa le stesse regole del rilascio di mouse e gizmo; mouse e gizmo arrotondano la rotazione con lo stesso `snappedRotation`; tastiera, Inspector e handle usano gli stessi comandi dello store.
- [x] Spostare le condizioni specifiche di un prodotto nei dati: `compatibleWith` del manifest decide la compatibilità quando è dichiarato; senza manifest decide la tabella dei tipi GLB, e i tipi che non si accoppiano con nulla (prima il letterale `'origine'`) non vengono proposti. Tolleranza predefinita unica (`DEFAULT_SNAP_TOLERANCE`).
- [x] Rimuovere effetti di sincronizzazione, helper e percorsi interni superflui: `OverlapDetector`, `resolveLegacyProject`, `reconcileConstraints`, `withSnapConstraint`, `assemblyContext`, il percorso «legacy» dell'aggancio guidato, i controlli `lockAxis` mai raggiungibili in `Item`, le funzioni inutilizzate di `useSceneTools`.
- [x] Documentare i confini tra moduli e il percorso per aggiungere un prodotto o una regola (README, sezione «Architettura»; `CLAUDE.md`).
- [x] Verificare nel browser trascinamento, rotazione, agganci, coppie specchiate, undo/redo, sola lettura, recupero dagli errori GLB ed esportazione. L'aggancio magnetico durante il trascinamento è coperto dai test di `tests/movement.test.mjs`.

**Criteri di completamento:** le regole di dominio principali si verificano senza montare React; le azioni equivalenti usano lo stesso comando; aggiungere un prodotto con regole già supportate non richiede modifiche ai componenti generici.

## Verifiche per ogni passo implementato

- [x] Aggiungere o aggiornare test di regressione sui comportamenti interessati e sulla compatibilità dei dati (`tests/commands.test.mjs` nuovo; regressioni su grafo, cronologia, reset e cache).
- [x] Eseguire `npm run lint`.
- [x] Eseguire `npm test`, che include build della libreria, regressioni e verifiche degli asset reali (91 test e i quattro script).
- [x] Eseguire `npm run build:demo`.
- [x] Eseguire una verifica manuale nel browser per le interazioni o il rendering modificati (demo e `tests/browser/index.html`).
- [x] Documentare eventuali effetti su API pubbliche, catalogo, schema e file esportati (sezione seguente).

La riduzione della complessità si valuta soprattutto dal numero di rappresentazioni, percorsi decisionali ed effetti di sincronizzazione eliminati. La diminuzione delle righe nei componenti è un indicatore secondario: spostare codice tra file, da solo, non basta.

## Effetti su API, dati e file

- **Formato dei file invariato.** Il JSON esportato contiene ancora il `snapToItem` di ogni giunto risolto (uno per pezzo sorgente) accanto a `connections`. Un `snapToItem` senza connessione corrispondente, anche con `connections: []`, è ora un collegamento in sospeso che viene risolto appena possibile, non un vincolo da segnalare.
- **`state.project` è la forma di editing**: non contiene i `snapToItem` derivati. Per la forma persistita usare `exportProject()`, `getProject()`, `onChange` o `onSave`.
- **Store:** nuovi `commitJoints` e `settleItemPosition`; `createMirrorPair` accetta `Joint[]` e conserva i giunti in sospeso; `setConnections` è deprecato; `assetEpoch` rimosso.
- **Nuovi export:** `selectJoints`, `selectCanMove`, `selectEffectiveAnchors`, `selectCollisionBounds`, `selectSelectedItem`, `selectAssemblyView`, `jointsOf`, `pendingJoints`, `isResolvedJoint`, tipo `Joint`.
- **`computeAttachmentPreview`** restituisce `joints`; `connections` e `legacy` restano, deprecati.
- **Compatibilità:** `connectorsCanMate` segue `compatibleWith` quando è dichiarato; la tabella dei tipi vale solo per connettori che non dichiarano nulla. Il manifest della demo e quello dell'esempio non cambiano risultato.
- **Prontezza e validazione:** non esiste più lo stato «Connessioni legacy da risolvere»; un collegamento non risolvibile con manifest caricato produce l'errore «Collegamento non riconosciuto dal manifest tecnico», che blocca la distinta. PNG e GLB restano disponibili.
- **Aggancio senza manifest:** non vengono proposti i punti di tipi che non si accoppiano con altri prodotti (`origine`, `terra`).
- **Rotazione dall'Inspector** di un pezzo libero: applica push-out, contenimento nel vano e mantenimento dell'anchor centrale come il rilascio di un gesto.

## Avanzamento

| Passo | Stato | Dipendenza |
| --- | --- | --- |
| 5. Collegamenti unificati | Completato e verificato | Passi 1–4 completati |
| 6. Stato separato per responsabilità | Completato e verificato | Passo 5 verificato |
| 7. Componenti e regole dei prodotti | Completato e verificato | Passo 6 verificato |
