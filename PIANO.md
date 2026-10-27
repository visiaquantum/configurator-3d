# Piano di semplificazione — tre passi finali

## Stato di partenza

I passi 1–4 sono completati: test dei comandi di movimento, aggiornamenti atomici del progetto, logica condivisa tra mouse/gizmo/Inspector e preparazione dei metadati per prodotto.

La migrazione legacy è già centralizzata nello store e attende metadati completi. Rimane però la doppia rappresentazione dei collegamenti tramite `connections` e vincoli `snapToItem`.

Questo documento descrive il lavoro ancora da eseguire. Procedere nell'ordine **5 → 6 → 7**, completando e verificando ciascun passo prima del successivo.

## Passo 5 — Unificare i collegamenti

**Obiettivo:** avere una sola fonte di verità per i collegamenti tra pezzi durante l'editing, mantenendo leggibili i progetti esistenti.

### Attività

- [ ] Definire il modello interno del grafo e distinguere un grafo vuoto da un progetto legacy ancora da risolvere.
- [x] Definire il comportamento in assenza di manifest o metadati: conservare i collegamenti non risolti senza convertirli in un grafo vuoto o perdere informazioni. Le scritture del grafo passano da `withConnections` (`state/projectGraph.ts`): su un progetto legacy non risolto i nuovi giunti diventano vincoli `snapToItem` e `connections` resta assente; `reconcileConstraints` rimuove solo i `snapToItem` derivati dal grafo precedente. Test: `tests/regressions.test.mjs` (tre casi sui collegamenti).
- [ ] Centralizzare le operazioni sul grafo: aggiunta, rimozione, ricerca dei vicini e individuazione dei membri di un assieme.
- [ ] Portare movimento, rotazione, aggancio guidato, aggancio magnetico, collisioni e validazione a leggere lo stesso modello.
- [ ] Eliminare la sincronizzazione continua tra `connections` e `snapToItem` dal nucleo dell'editing. Gestire `snapToItem` negli adattatori di compatibilità per import/export e per le API pubbliche che lo espongono.
- [ ] Conservare il comportamento delle coppie specchiate e degli ancoraggi al vano: non sono equivalenti ai collegamenti tra connettori.
- [ ] Verificare importazione, esportazione e undo/redo con progetti legacy, moderni e assiemi con più giunti per pezzo.

**Criteri di completamento:** ogni operazione sull'assieme consulta un'unica rappresentazione; nessuna modifica richiede di mantenere manualmente due strutture parallele; nessuna migrazione parziale viene salvata; i progetti esistenti mantengono i collegamenti.

## Passo 6 — Separare lo stato per responsabilità

**Obiettivo:** rendere esplicito cosa viene salvato, cosa appartiene all'interazione corrente e cosa serve al rendering.

### Attività

- [ ] Classificare i campi dello store in progetto persistente, interazioni temporanee, risorse della scena e dati derivati.
- [ ] Separare tipi, azioni e selettori in moduli dedicati, mantenendo un punto di composizione per ciascun configuratore. Non introdurre store indipendenti se rendono più difficile un aggiornamento atomico.
- [ ] Concentrare la cronologia sulle modifiche persistenti del progetto: selezione, anteprime, caricamenti e riferimenti Three.js non devono generare passi di undo.
- [ ] Definire esplicitamente il reset delle interazioni e delle risorse quando cambiano progetto, catalogo o modalità di sola lettura.
- [ ] Ridurre le sottoscrizioni ampie nei componenti, usando selettori dei soli dati necessari.
- [ ] Eliminare lo stato duplicato quando può essere derivato in modo affidabile; mantenere cache soltanto dove evitano elaborazioni costose.
- [ ] Conservare l'API pubblica esistente mediante adattatori dove necessario e verificare l'isolamento tra più configuratori.

**Criteri di completamento:** ogni campo ha una responsabilità chiara; dati temporanei e oggetti della scena non entrano nel progetto esportato o nella cronologia; i comandi restano atomici; due configuratori non condividono stato modificabile.

## Passo 7 — Alleggerire i componenti e isolare le regole dei prodotti

**Obiettivo:** lasciare ai componenti React la presentazione e il collegamento degli eventi, rendendo le decisioni di dominio verificabili separatamente.

### Attività

- [ ] Esaminare la logica rimasta in `Item`, `Configurator3D` e `Inspector`, distinguendo rendering, gestione degli eventi e decisioni di dominio.
- [ ] Estrarre le decisioni residue in funzioni o comandi con ingressi e risultati espliciti; usare hook soltanto per comportamento legato al ciclo di vita React.
- [ ] Far convergere le azioni equivalenti di mouse, gizmo, tastiera e Inspector sugli stessi comandi.
- [ ] Individuare eventuali condizioni specifiche di un prodotto e spostarle in catalogo, manifest o regole validate, mantenendo le convenzioni dei GLB esistenti.
- [ ] Rimuovere effetti di sincronizzazione, helper e percorsi di compatibilità interni resi superflui dai passi precedenti.
- [ ] Documentare i confini tra moduli e il percorso necessario per aggiungere un prodotto o una regola.
- [ ] Verificare nel browser trascinamento, rotazione, agganci, coppie specchiate, undo/redo, sola lettura, recupero dagli errori GLB ed esportazione.

**Criteri di completamento:** le regole di dominio principali si verificano senza montare React; le azioni equivalenti usano lo stesso comando; aggiungere un prodotto con regole già supportate non richiede modifiche ai componenti generici.

## Verifiche per ogni passo implementato

- [ ] Aggiungere o aggiornare test di regressione sui comportamenti interessati e sulla compatibilità dei dati.
- [ ] Eseguire `npm run lint`.
- [ ] Eseguire `npm test`, che include build della libreria, regressioni e verifiche degli asset reali.
- [ ] Eseguire `npm run build:demo`.
- [ ] Eseguire una verifica manuale nel browser per le interazioni o il rendering modificati, conservando una schermata o registrazione.
- [ ] Documentare eventuali effetti su API pubbliche, catalogo, schema e file esportati.

La riduzione della complessità si valuta soprattutto dal numero di rappresentazioni, percorsi decisionali ed effetti di sincronizzazione eliminati. La diminuzione delle righe nei componenti è un indicatore secondario: spostare codice tra file, da solo, non basta.

## Avanzamento

| Passo | Stato | Dipendenza |
| --- | --- | --- |
| 5. Collegamenti unificati | In corso; migrazione centralizzata, collegamenti non risolti preservati | Passi 1–4 completati |
| 6. Stato separato per responsabilità | Da iniziare | Passo 5 verificato |
| 7. Componenti e regole dei prodotti | Da iniziare | Passo 6 verificato |
