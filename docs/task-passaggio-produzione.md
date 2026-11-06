# Task per il passaggio del configuratore alla produzione

Data: 5 novembre 2026

## Obiettivo e perimetro

Ricostruire manualmente la parete Tasca del preventivo 99003819, partendo da una scena vuota, usando un catalogo ricavato dai GLB e un manifest che descrive prodotti e regole di montaggio. Nessuna coordinata deve essere inserita manualmente dall'utente e nessuna correzione specifica dei prodotti deve rimanere nel codice applicativo.

Il catalogo comprende i file GLB; descrizioni, categorie e regole risiedono nel manifest. Non è richiesto un CSV separato. L'interfaccia di composizione resta nell'applicazione esterna alla libreria. La generazione automatica della parete da un preventivo è esclusa dal percorso di produzione.

Riferimento: [piano di passaggio alla produzione](piano-passaggio-produzione.md). Questa checklist incorpora anche il percorso concordato di composizione manuale.

## Come seguire i task

Le caselle sono inizialmente aperte: non rappresentano una verifica già eseguita. Aggiornamento del 5 novembre 2026: spuntati i task con risultato e verifica disponibili; i due ancora aperti (T04, T11) attendono la conferma e i dati del cliente e riportano lo stato sotto il titolo. Spuntare un task quando sono disponibili il risultato richiesto e la relativa verifica. Per ogni fase registrare il commit o il documento che ne dimostra il completamento, insieme a eventuali problemi ancora aperti.

Le dipendenze indicano l'ordine di lavoro. Le verifiche dei singoli componenti vanno sviluppate insieme alle funzioni; il collaudo finale non sostituisce le verifiche intermedie.

## Fase 1 Conservare il riferimento della parete Tasca

Responsabilità: sviluppo, con conferma del cliente sulle regole meccaniche. Nessuna dipendenza.

- [x] **T01 — Inventariare i prodotti.** Elencare codici, quantità, campate, altezze e collegamenti necessari alla parete del preventivo 99003819.
- [x] **T02 — Censire le correzioni della demo.** Esaminare `src/App.tsx` e `src/tascaWall.ts`; per ogni valore specifico indicare prodotto, motivo e destinazione futura: GLB, manifest o funzione generica.
- [x] **T03 — Conservare il progetto di riferimento.** Salvare GLB, manifest, progetto JSON e distinta usati per il confronto, indicando la revisione degli asset.
- [ ] **T04 — Documentare i dettagli di montaggio.** Salvare immagini di staffe, profili, colonne anteriori e posteriori, sovrapposizioni e coppie specchiate. Far confermare al cliente i dettagli che esprimono una regola meccanica.
  *Stato: immagini pronte in [dettagli-montaggio.md](dettagli-montaggio.md) (`npm run catalog:images`); **aperto**: conferma del cliente delle regole indicate «Da confermare».*
- [x] **T05 — Conservare le regressioni esistenti.** Identificare i test dipendenti da `tascaWall.ts` e definire come mantenerne la copertura dopo la rimozione del generatore.

**Criterio di completamento:** esiste un riferimento riproducibile di geometria, collegamenti e distinta; ogni correzione della demo è censita.

**Esito fase 1:** [riferimento della parete](../tests/fixtures/tasca-99003819/README.md) (inventario, censimento, progetto e distinta di riferimento, hash degli asset, regressioni), [dettagli di montaggio](dettagli-montaggio.md). Aperto: conferma del cliente (T04).

## Fase 2 Definire GLB e manifest

Responsabilità: sviluppo per il formato; cliente per dati e regole. Dipendenza: fase 1.

- [x] **T06 — Formalizzare il contratto GLB.** Definire unità in metri, orientamenti, origine, nomi dei file, marker `SNAP_<TIPO>__<NOME>` e posizione del loro centro sulla superficie di contatto. Verificare un'esportazione reale del CAD del cliente.
  *Fatto: [contratto-glb-manifest.md](contratto-glb-manifest.md) § 1; il controllo gira sulle esportazioni reali attuali (marker numerati e cubetti appoggiati sulla faccia, segnalati). Da ripetere sulla prima esportazione con `SNAP_<TIPO>__<NOME>`.*
- [x] **T07 — Definire identità e revisioni.** Stabilire normalizzazione dei codici, unicità dei marker, versione dello schema e revisione del catalogo. Definire come conservare le revisioni necessarie a riaprire i progetti.
- [x] **T08 — Estendere lo schema del manifest.** Aggiungere descrizioni, categorie, istruzioni, colonne di fori, coppie specchiate, campate e direzioni. Conservare compatibilità, capacità, collider, tolleranze e distinta già previsti.
- [x] **T09 — Specificare completamente le colonne di fori.** Definire origine, primo foro, passo, numero o limite finale, asse, verso, identificativi stabili e posizione rispetto alla lamiera. Trattare separatamente colonne anteriori e posteriori.
- [x] **T10 — Definire coordinate e precedenze.** Dichiarare il sistema di riferimento di ogni parametro e come interagiscono manifest, marker e deduzione automatica. Specificare asse e verso degli arretramenti, evitando doppie correzioni.
- [ ] **T11 — Preparare i primi manifest reali.** Descrivere un fianco, un cassetto e un'antina, includendo viteria e istruzioni utili all'utente. Separare eventuali correzioni per asset precedenti dai requisiti dei nuovi GLB.
  *Stato: fianco `ysi03036`, cassetto `kdw40236` e antina `kld41000` descritti in `catalog/manifest.json` con istruzioni, correzioni dei GLB attuali separate (`assetCorrections`). **Aperto**: codici della viteria (`bomComponents`) da fornire dal cliente.*

**Criterio di completamento:** i tre prodotti pilota sono descritti senza campi impliciti o dati da aggiungere nel codice TypeScript.

**Esito fase 2:** [contratto GLB e manifest](contratto-glb-manifest.md), schema v2 in `src/lib/assembly/manifest.ts`, manifest reale [`catalog/manifest.json`](../catalog/manifest.json). Aperto: viteria (T11), esportazione con nomi stabili (T06).

## Fase 3 Implementare il montaggio dei prodotti pilota

Responsabilità: sviluppo. Dipendenza: fase 2.

- [x] **T12 — Leggere gli identificativi stabili.** Separare tipo e nome nei marker; rilevare duplicati anche prima delle rinominazioni del caricatore. Stabilire il comportamento per i vecchi marker numerati.
- [x] **T13 — Normalizzare la geometria.** Calcolare l'ingombro senza marker e applicare in modo coerente scala e trasformazioni fra coordinate del GLB, prodotto e scena.
- [x] **T14 — Applicare le regole del manifest.** Preparare i dati del prodotto attraverso un percorso generico, senza condizioni basate sui codici dei prodotti Tasca.
- [x] **T15 — Generare i fori dei fianchi.** Implementare le colonne parametrizzate, gli identificativi stabili e la posizione sulla faccia interna della lamiera.
- [x] **T16 — Gestire direzioni e coppie.** Applicare direzioni esplicite, asse della coppia e campate ammesse. Segnalare le direzioni ambigue quando mancano informazioni sufficienti.
- [x] **T17 — Verificare trasformazioni e contatti.** Provare rotazione, specchiatura, fronte e retro; controllare che le staffe restino dietro la lamiera e che le correzioni siano applicate una sola volta.
- [x] **T18 — Completare il primo montaggio manuale.** Inserire due fianchi, un cassetto e un'antina da una scena vuota usando i nuovi dati, poi salvare e riaprire il progetto.

**Prima tappa verificabile:** il piccolo assieme si compone dall'interfaccia senza coordinate manuali né correzioni specifiche nel codice. Non estendere il lavoro a tutto il catalogo prima di aver superato questa prova.

**Esito fase 3:** marker stabili e duplicati (`src/lib/io/itemSnaps.ts`), costruzione generica (`src/lib/io/productCatalog.ts`), precedenze e direzioni (`src/lib/scene/productAsset.ts`), campate (`bay-not-allowed` in `src/lib/assembly/validation.ts`); test `tests/catalog.test.mjs` e `tests/tasca-wall.test.mjs` («the pilot assembly composes by hand…», salvataggio e riapertura).

## Fase 4 Validare i cataloghi prima dell'uso

Responsabilità: sviluppo; cliente per la conferma dei montaggi. Dipendenza: fase 3. I controlli di schema possono iniziare nella fase 2.

- [x] **T19 — Realizzare il controllo strutturale.** Rilevare GLB illeggibili, codici duplicati, manifest mancanti, marker duplicati, punti inesistenti e parametri non validi.
- [x] **T20 — Realizzare gli avvisi geometrici.** Segnalare dimensioni sospette, marker lontani dalle superfici, direzioni ambigue e modelli troppo pesanti. Definire soglie e tolleranze esplicite.
- [x] **T21 — Aggiungere prove sugli assiemi.** Controllare fianco con cassetto, antina, ripiano e angolare; verificare colonne anteriori e posteriori, sovrapposizioni e zone di compenetrazione consentite.
- [x] **T22 — Produrre un rapporto utilizzabile.** Ogni problema deve riportare gravità, file o prodotto, punto coinvolto e intervento richiesto. Distinguere errori bloccanti, avvisi e controlli che richiedono conferma del cliente.
- [x] **T23 — Collegare la validazione alla pubblicazione.** Impedire la pubblicazione di una revisione con errori bloccanti e registrare l'esito dei controlli insieme alla revisione.

**Criterio di completamento:** un catalogo errato viene fermato con indicazioni precise; i montaggi campione validi superano i controlli. La verifica automatica non sostituisce la conferma delle intenzioni meccaniche del cliente.

**Esito fase 4:** `checkCatalog` / `formatCatalogReport` (`src/lib/io/catalogCheck.ts`), `npm run catalog:check`, pubblicazione bloccata dagli errori con rapporto salvato (`npm run catalog:publish`); test in `tests/catalog.test.mjs`. La conferma delle intenzioni meccaniche resta al cliente (`review`).

## Fase 5 Caricare il catalogo dai GLB

Responsabilità: sviluppo frontend e backend. Dipendenze: contratto della fase 2 e controlli della fase 4 per la pubblicazione.

- [x] **T24 — Definire e implementare l'API del catalogo.** Restituire codici, URL degli asset, manifest associato e revisione; specificare errori, accesso e comportamento in caso di risorse mancanti.
- [x] **T25 — Preparare ingombri e anteprime.** Generarli dai GLB durante la preparazione del catalogo e aggiornarli quando cambia la revisione degli asset.
- [x] **T26 — Caricare il catalogo nell'applicazione.** Costruire automaticamente le voci usando file e manifest, caricando i modelli quando servono e mostrando gli errori in modo comprensibile.
- [x] **T27 — Pubblicare revisioni coerenti.** Garantire che elenco, GLB, anteprime e manifest appartengano alla stessa revisione; verificare il ritorno a una revisione precedente.
- [x] **T28 — Provare l'aggiunta di un prodotto.** Aggiungere un GLB e la sua definizione nel manifest, validare e pubblicare; verificare che compaia senza modificare il codice applicativo.

**Criterio di completamento:** il catalogo Tasca viene alimentato dai file e dal manifest, senza elenchi TypeScript per prodotto.

**Esito fase 5:** API in [gestione-catalogo.md](gestione-catalogo.md) § 7, implementazione di riferimento in `public/catalog/` (`current.json`, `revisions/<rev>/`, anteprime per hash), `loadCatalogRevision` / `buildCatalogFromIndex`, rollback verificato; l'applicazione non ha più elenchi di prodotti.

## Fase 6 Guidare la composizione manuale

Responsabilità: sviluppo. Dipendenze: fasi 3 e 5.

- [x] **T29 — Esporre i dati necessari all'applicazione.** Definire API pubbliche per consultare prodotti, regole e compatibilità, evitando import da moduli interni della libreria.
- [x] **T30 — Completare la consultazione del catalogo.** Integrare ricerca, categorie, descrizioni e istruzioni di montaggio dal manifest.
- [x] **T31 — Rendere comprensibili i punti di aggancio.** Mostrare nomi, altezze, stato libero o occupato e anteprima del collegamento; consentire la scelta della campata prevista.
- [x] **T32 — Spiegare le incompatibilità.** Filtrare i prodotti compatibili e distinguere punto occupato, famiglia incompatibile, campata non ammessa e collisione.
- [x] **T33 — Verificare le operazioni di composizione.** Provare selezione, coppie specchiate, spostamento, eliminazione, annulla e ripristina, mantenendo coerenti collegamenti e distinta.
- [x] **T34 — Estendere il percorso a tutta la parete.** Preparare e validare i manifest dei prodotti restanti, quindi costruire manualmente la parete completa del preventivo 99003819.

**Criterio di completamento:** un utente può scegliere i prodotti, capire dove montarli e completare la parete senza conoscere coordinate o dettagli del formato dati.

**Esito fase 6:** API pubbliche (`productCompatibility`, `compatibleCatalogIds`, `attachmentPointStates`, `attachmentTargetStates`, `pairSpacingOptions`, `setMirrorPairDistance`, `definitionFor`, `Icon`, `themeStyles`); catalogo con ricerca, categorie, descrizioni e istruzioni; pannello di aggancio con nomi, altezze, stato e motivo, scelta della campata; parete completa composta a mano e confrontata con il riferimento (`tests/tasca-wall.test.mjs`, `tests/e2e/app.spec.ts`).

## Fase 7 Consolidare progetti e veicolo

Responsabilità: sviluppo; cliente per asset e ancoraggi del furgone. Dipendenze: fasi 2 e 3 per il formato; fase 6 per il collaudo completo.

- [x] **T35 — Salvare riferimenti riproducibili.** Registrare la revisione del catalogo e del manifest insieme agli identificativi di prodotti, punti e connessioni.
- [x] **T36 — Gestire revisioni mancanti e progetti precedenti.** Segnalare risorse non disponibili senza sostituzioni silenziose; definire e verificare la migrazione dei vecchi progetti oppure mantenerli come casi di prova separati.
- [x] **T37 — Verificare salvataggio e riapertura.** Confrontare posizioni, orientamenti, coppie, collegamenti e distinta prima e dopo la riapertura; ripetere con un GLB riesportato con gli stessi marker.
- [x] **T38 — Leggere gli ancoraggi del furgone.** Usare il centro geometrico dei cubetti `anchor_<NOME>` e verificare trasformazioni e direzioni.
- [x] **T39 — Definire e applicare il manifest del veicolo.** Configurare vano, pianale, scala e dati mancanti dal GLB; verificare origine, orientamento e rappresentazione di `Body_interior`.
- [x] **T40 — Collaudare la parete nel veicolo.** Verificare posizionamento, ancoraggi e vincoli del vano sul modello previsto per la consegna.
- [x] **T41 — Decidere e completare il perimetro delle porte.** Registrare se le porte mobili sono richieste nella prima consegna. Se incluse, definire nodi, perni, assi e corse e provarne l'apertura; altrimenti documentare il rinvio.
  *Decisione registrata il 6 novembre 2026 (Andrea Termini): porte mobili escluse dalla prima consegna, rinvio documentato in [collaudo-produzione.md](collaudo-produzione.md); formato `doors` già pronto per quando il cliente esporterà le porte come nodi.*

**Criterio di completamento:** la composizione nel veicolo può essere salvata e riaperta senza alterazioni e senza dipendere dai dati del furgone scritti nella demo.

**Esito fase 7:** `project.catalog.revision`, apertura con la revisione del progetto o scelta esplicita, ancoraggi al centro del cubetto, manifest dei veicoli; [collaudo-produzione.md](collaudo-produzione.md). Porte rinviate (T41, decisione registrata). Aperto: conferma dei dati dei veicoli.

## Fase 8 Collaudare e rimuovere la demo

Responsabilità: sviluppo, con accettazione del caso di montaggio da parte del cliente. Dipendenza: fasi precedenti.

- [x] **T42 — Eseguire il collaudo completo.** Ricostruire la parete da una scena vuota; confrontare geometria, agganci e distinta con il riferimento della fase 1 e conservare immagini del risultato.
- [x] **T43 — Provare gli errori e gli aggiornamenti.** Verificare file mancante, marker duplicato, manifest incompatibile, revisione mancante e aggiornamento di un prodotto.
- [x] **T44 — Misurare le prestazioni.** Concordare dispositivi, dimensione del catalogo e soglie accettabili; misurare avvio, caricamento dei prodotti e fluidità della composizione.
  *Soglie concordate il 6 novembre 2026 (Andrea Termini): desktop/portatile aziendale, catalogo attuale (~20 prodotti); catalogo pronto < 2 s, primo modello < 1 s, parete valida < 5 s, frame mediano < 20 ms. Misure in [collaudo-produzione.md](collaudo-produzione.md) e `tests/e2e/production.spec.ts`.*
- [x] **T45 — Verificare gli export richiesti.** Controllare distinta, PNG, GLB e PDF sulla composizione finale, con quantità e rappresentazione coerenti con la scena.
- [x] **T46 — Eliminare le dipendenze dalla demo.** Rimuovere dati specifici da `App.tsx`, uso operativo di `tascaWall.ts`, generatore della parete e pulsanti dimostrativi. Conservare le fixture necessarie ai test e verificare che non alimentino il percorso di produzione.
- [x] **T47 — Eseguire le verifiche finali dopo la rimozione.** Eseguire `npm run lint`, `npm test`, `npm run build:lib` e `npm run build:demo`. Aggiungere ed eseguire prove dell'interfaccia per la composizione manuale, il salvataggio e la riapertura.
- [x] **T48 — Consegnare la procedura di gestione del catalogo.** Documentare preparazione GLB, compilazione manifest, validazione, pubblicazione, gestione delle revisioni e correzione degli errori.

**Criterio di completamento:** la parete Tasca è costruibile manualmente con il catalogo di produzione; le verifiche passano dopo la rimozione delle dipendenze dalla demo e l'aggiunta di prodotti non richiede modifiche al codice.

**Esito fase 8:** [collaudo-produzione.md](collaudo-produzione.md), [gestione-catalogo.md](gestione-catalogo.md); demo rimossa dal percorso di produzione (`tests/production-path.test.mjs`). Soglie delle prestazioni concordate (T44).

## Ordine delle consegne

| Consegna | Risultato verificabile | Task |
| --- | --- | --- |
| Riferimento e contratto | Caso Tasca conservato e formato concordato | T01–T11 |
| Primo assieme manuale | Due fianchi, un cassetto e un'antina | T12–T18 |
| Catalogo validato | Controlli, API, anteprime e aggiunta di un prodotto | T19–T28 |
| Parete completa | Composizione guidata di tutti i prodotti Tasca | T29–T34 |
| Progetto nel veicolo | Revisioni, riapertura e ancoraggi verificati | T35–T41 |
| Consegna di produzione | Collaudo, rimozione della demo e istruzioni operative | T42–T48 |
