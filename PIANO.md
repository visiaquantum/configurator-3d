# Roadmap MVP avanzato — Configuratore tecnico di allestimenti 3D

## Sintesi

Il prodotto ha già una base 3D valida: catalogo GLB, scena interattiva, persistenza JSON, snapping, vincoli padre-figlio, collisioni, BOM/PDF e controlli visuali. L’MVP deve ora diventare un configuratore di assiemi affidabile: un tecnico o commerciale deve poter partire da vano vuoto, costruire un allestimento valido e generare una BOM tecnica.

Decisioni fissate:

| Decisione | Scelta |
|---|---|
| Utenti MVP | Tecnici interni e commerciali |
| Catalogo | Pilota ristretto: un vano e 5–15 famiglie prodotto |
| Output affidabile | Configurazione validata + BOM tecnica; niente pricing/ERP |
| Dati incastro | Manifest esterno, versionato e validato |
| Interazione primaria | Drag con anteprima di snap verde/rossa |
| Materiali/texture | Fuori dall’MVP; dopo la correttezza meccanica |

## Stato dopo le correzioni

Sono presenti manifest e connessioni esplicite, controllo di capacità e tolleranze, collisioni limitate dalle clearance, preview dell'intero assieme, ricerca catalogo e pannello errori. Ogni configuratore dispone di store e registro indipendenti. Gli asset sono clonati per istanza, il rilevamento dei fori usa una cache e la scena non richiede più un HDR esterno implicito. Import/export, readonly, reset, storia e rimozione dei collegamenti sono coperti da test automatici e CI.

La documentazione operativa aggiornata è in [README.md](README.md). Restano obiettivi di prodotto da misurare nel pilota: asset budget, prove con utenti reali, prestazioni su hardware di riferimento e verifica CAD dei collider dichiarati. Le tabelle seguenti descrivono il piano originale e non costituiscono un elenco aggiornato di bug aperti.

## Gap analysis e audit originari

| Area | Stato attuale | Gap / rischio | Priorità |
|---|---|---|---|
| Connessioni | Snap point, compatibilità, orientamento e legami padre-figlio già esistono | Lo snap è un punto, non ancora un giunto con profondità, occupazione e volume d’incastro consentito | Must-have |
| Collisioni | AABB, push-out e feedback rosso funzionano | Due item connessi escludono oggi tutta la collisione reciproca: consente anche compenetrazioni errate | Must-have |
| Modello dati | Catalogo, progetto JSON e migrazioni esistono | Manca una definizione esterna di connettori, collider semplificati, capacità snap e regole d’assieme | Must-have |
| UX di configurazione | Drag, Inspector, griglia, viste e walk mode | Mancano flusso “nuova configurazione”, ricerca catalogo, preview di aggancio e lista errori azionabile | Must-have |
| Asset pipeline | GLB con marker e rilevamento fori; validatore iniziale presente | Dipendenza da naming CAD e rilevamento runtime; mancano asset budget, manifest e validazione completa in CI | Must-have |
| Performance | GLTF cache/preload, Suspense separati e materiali PBR | Auto-rilevamento fori per istanza, cloni materiali, HDR 4K e collisioni O(N²) per frame limiteranno la scalabilità | Must-have |
| Stato libreria | API e store funzionanti per la demo | Store globale e reset da props rendono fragile il riuso con più configuratori o host React complessi | Nice-to-have nel pilota, Must-have prima della diffusione |
| Qualità | Script headless sugli snap | Non c’è una suite automatizzata di dominio, integrazione e scenari utente | Must-have |

Il principale refactoring è separare il dominio “configurazione meccanica” dal renderer 3D:

```text
Manifest catalogo + regole
        ↓
Motore di assieme e validazione
        ↓
Project JSON / BOM
        ↓
Three.js: visualizzazione, drag e preview
```

## Benchmark e feature selezionate

I configuratori enterprise convergono su configurazione guidata, regole di prodotto, visualizzazione in tempo reale, output di distinta e integrazioni commerciali. [Threekit Visual Configurator](https://www.threekit.com/visual-configurator), [Threekit + Oracle CPQ](https://www.threekit.com/ecommerce-platform-integration/oracle-cpq-integration) e [Autodesk Configured Designs BOM](https://www.autodesk.com/products/fusion-360/blog/september-2026-major-product-update-whats-new/) mostrano che regole, BOM e output downstream sono più importanti della sola resa grafica.

| Feature di mercato | Valore | Decisione MVP |
|---|---|---|
| Composizione modulare da zero | È il caso d’uso centrale | Must-have |
| Regole di compatibilità e configurazione guidata | Evita errori tecnici e accelera il commerciale | Must-have |
| Snap con preview e validazione dell’incastro | Traduce la logica meccanica in interazione chiara | Must-have |
| BOM tecnica automatica | Trasforma la scena in output operativo | Must-have |
| Salvataggio/import/export progetto | Necessario per revisione e continuità operativa | Must-have |
| PDF con immagine e BOM | Già presente, da rendere validato e professionale | Must-have |
| Materiali/colori/texture in tempo reale | Alto valore estetico, non determina correttezza tecnica | Post-MVP |
| Pricing, preventivo, ERP/CPQ | Alto valore commerciale ma richiede dati e ownership esterni | Post-MVP |
| AR, collaborazione live, CAD automatico | Valuable ma non essenziale al pilota | Post-MVP |

## Piano d’azione

| Fase | Obiettivo | Must-have | Nice-to-have | Metriche di successo |
|---|---|---|---|---|
| 1. Core architecture | Rendere ogni assieme deterministico e validabile | Manifest, connettori, collider, motore vincoli, validazione, migrazione JSON | Store per istanza | 100% delle connessioni del pilota dichiarate e validabili; riapertura progetto senza drift oltre la tolleranza del connettore |
| 2. UX e performance 3D | Rendere veloce e comprensibile la costruzione da zero | Catalogo guidato, drag-preview, error panel, budget asset, cache e collisione efficiente | Viste salvate, scorciatoie avanzate | ≥80% degli utenti pilota completa uno scenario standard senza assistenza; scena interattiva ≥30 FPS al percentile 75 sul catalogo pilota |
| 3. Output e hardening | Rendere l’output tecnicamente usabile e pronto al rilascio | BOM validata, PDF/JSON/GLB, test automatici, osservabilità errori | Link condivisibile e persistenza server | BOM corrisponde al 100% alla configurazione validata; zero errori bloccanti nei casi pilota |

### 1. Core architecture e motore di assieme

Requisiti tecnici:

- Introdurre un manifest JSON versionato, sorgente di verità del catalogo pilota.
- Ogni prodotto dichiara:
  - connettori/snap stabili;
  - famiglia e compatibilità;
  - frame di innesto: posizione, normale, asse e profondità;
  - capacità del connettore;
  - collider solidi semplificati;
  - zone di compenetrazione consentite per lo specifico innesto.
- Sostituire il modello “item connessi non collidono” con collisione contestuale:
  - i volumi solidi non possono intersecare;
  - l’intersezione è ammessa soltanto dentro le clearance zone del connettore selezionato;
  - un item collegato male resta invalido anche se è formalmente legato.
- Estrarre un motore puro per:
  - ricerca candidati compatibili;
  - risoluzione di posizione/orientamento;
  - controllo occupazione snap;
  - propagazione degli assiemi;
  - validazione globale e generazione issue.
- Conservare compatibilità con il JSON corrente: `snapToItem` viene letto come connessione legacy e migrato alla nuova forma quando sono disponibili dati manifest.

API/tipi pubblici minimi:

- `AssemblyManifest`: definizioni per prodotto, connettori, collider e regole.
- `Connection`: riferimento a item sorgente, connettore sorgente, item target, connettore target e trasformazione risolta.
- `ValidationIssue`: severità, item coinvolti, codice e messaggio risolvibile in UI.
- `Configurator3DProps.assemblyManifest`: manifest inline o URL.
- `ConfiguratorHandle.getValidation()` e `onValidationChange`: stato configurazione per host e workflow BOM.

### 2. UX di configurazione e ottimizzazione 3D

Requisiti tecnici:

- Aggiungere un’azione esplicita “Nuova configurazione” che parte dal vano vuoto e non dipende da item iniziali.
- Evolvere il catalogo pilota con categorie, ricerca, disponibilità/compatibilità contestuale e inserimento guidato.
- Durante il drag:
  - cercare solo candidati compatibili vicini;
  - mostrare ghost nella trasformazione di innesto risolta;
  - usare verde per innesto valido e rosso con causa quando un collider o una regola blocca l’azione;
  - creare la `Connection` solo al rilascio su preview valida.
- Mantenere l’Inspector come alternativa di precisione e debug, non come percorso principale.
- Introdurre un pannello di validazione: collisioni, snap incompleti, item fuori vano, vincoli mancanti e azione suggerita.
- Spostare rilevamento fori e metadati dal costo per istanza a una pipeline/precaricamento per tipo prodotto.
- Stabilire budget per asset pilota: GLB compressi, texture compresse, LOD quando necessario, HDR a risoluzione adeguata e caricamento progressivo.
- Limitare collisioni e aggiornamenti di store alle sole trasformazioni modificate; usare broad phase spaziale quando il pilota supera le poche decine di item.

### 3. BOM, export e qualità di rilascio

Requisiti tecnici:

- Generare la BOM esclusivamente da una configurazione senza errori bloccanti.
- Includere nella BOM: codice articolo, descrizione, quantità, varianti e componenti/giunti richiesti dal manifest.
- Mantenere export JSON come fonte portabile; PDF con screenshot, dati progetto, esito validazione e distinta; GLB come output visuale.
- Mostrare nel PDF e nella UI lo stato “validato” con versione di catalogo/manifest usata.
- Aggiungere telemetria tecnica non invasiva: tempi asset load, frame time, errori manifest, fallimenti export e configurazioni non valide.
- Rinviare link live, autenticazione, collaborazione, preventivo, prezzi ed ERP a una fase successiva con backend dedicato.

## Test e criteri di accettazione

- Test unitari del motore: compatibilità, orientamento, profondità, capacità snap, cicli, propagazione assieme e migrazione legacy.
- Test collider: il montante–XDS può incastrarsi solo nelle clearance zone autorizzate; collisioni al di fuori restano bloccanti.
- Test asset/CI: ogni GLB e manifest del pilota ha scala, connettori e collider validi; nessun ID duplicato o riferimento mancante.
- Test end-to-end: creare da zero un allestimento campione, collegare montanti e XDS, salvare, riaprire, esportare PDF/JSON e verificare BOM.
- Test performance: cold load, inserimento prodotto, drag con preview ed export su macchina desktop target.
- Test di usabilità con tecnici e commerciali: completamento di uno scenario standard, tasso di configurazioni invalide e tempo di correzione.

## Primi tre passaggi operativi

1. Definire lo scenario pilota di riferimento e il manifest di un primo incastro reale montante–XDS: connettori, trasformazione, collider solidi e clearance consentite.
2. Implementare e testare il motore di assieme/validazione puro, sostituendo l’esenzione globale dalle collisioni tra item collegati.
3. Integrare drag con ghost-preview e pannello errori, poi validare il flusso completo “vano vuoto → assieme → BOM” con tecnici e commerciali.
