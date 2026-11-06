# Gestione del catalogo: preparazione, controllo, pubblicazione

Procedura operativa (T48) e contratto dell'API del catalogo (T24). Il formato
dei file è in [contratto-glb-manifest.md](contratto-glb-manifest.md).

## 1. Il flusso

```
cartella GLB  ─┐
               ├─▶ controllo ─▶ (errori? stop) ─▶ revisione pubblicata ─▶ applicazione
manifest      ─┘                                   indice · manifest · rapporto · anteprime
```

| Comando | Cosa fa |
| --- | --- |
| `npm run build:lib` | una volta, prima degli strumenti (usano la libreria compilata) |
| `npm run catalog:check` | controlla `public/models` + `catalog/manifest.json`, stampa il rapporto, esce con 1 se ci sono errori bloccanti. Opzioni: `--models`, `--manifest`, `--report file.json` |
| `npm run catalog:publish` | controlla e, se non ci sono errori, pubblica la revisione in `public/catalog/` con anteprime generate dai GLB. Opzioni: `--models`, `--manifest`, `--out`, `--no-previews` |
| `npm run catalog:publish -- --rollback <rev>` | torna a una revisione pubblicata, se i suoi GLB sono ancora quelli |
| `npm run catalog:images` | immagini dei dettagli di montaggio degli assiemi campione in `docs/montaggio/` |

Gli strumenti sono il riferimento di ciò che fa il backend: usano le stesse
funzioni della libreria (`checkCatalog`, `buildCatalogFromIndex`), quindi un
controllo superato qui è superato anche lì.

## 2. Preparare un GLB

1. Esportare in metri, Y in alto, con l'orientamento del contratto.
2. Nominare il file con il codice prodotto e metterlo nella cartella della
   categoria.
3. Mettere un cubetto `SNAP_<TIPO>__<NOME>` centrato su ogni superficie di
   contatto (sui pezzi appesi: faccia della staffa, a entrambe le estremità).
   Nessun marker sui fori dei fianchi.
4. Veicoli: `Body_interior`, cubetti `anchor_<NOME>` sul pianale, porte come
   nodi separati.

## 3. Compilare il manifest

Per ogni GLB una voce in `products` (o `enclosures`): identità e testi
(`code`, `label`, `description`, `category`, `instructions`), connettori e
compatibilità, collider, distinta, e se serve colonne di fori, coppia
specchiata, campate, direzioni. Le regole meccaniche le fornisce il cliente:
finché non le ha confermate, `review.confirmed` resta `false` e il rapporto le
elenca tra le conferme richieste. Un assieme campione in `samples` per ogni
famiglia di montaggio nuova.

## 4. Leggere il rapporto

Ogni riga ha gravità, codice, file o prodotto, punto e intervento richiesto:

```
ERRORI BLOCCANTI (1)
- [marker-duplicate] ORIZZONTALI/BAR-02.glb · end_a: Il marker end_a compare 2 volte
  → Dare a ogni marker SNAP_<TIPO>__<NOME> un nome unico nel file e riesportare.
```

| Gravità | Effetto | Esempi |
| --- | --- | --- |
| errore | la revisione **non** si pubblica | GLB illeggibile, codice duplicato, GLB senza manifest o manifest senza GLB, marker duplicato o malformato, connettore senza punto, riferimento sconosciuto, parametro non valido, assieme campione non valido, pezzo oltre la lamiera |
| avviso | si pubblica, va risolto | marker numerati, marker fuori dalla superficie, direzione ambigua, ingombro sospetto, modello pesante, correzione per un file cambiato, veicolo senza vano o ancoraggi |
| conferma | si pubblica, va confermato dal cliente | regole di un prodotto o dati di un veicolo non confermati (`review`) |

Soglie (`DEFAULT_CATALOG_THRESHOLDS`, modificabili per backend):

| Soglia | Valore |
| --- | --- |
| lato minimo / massimo del corpo | 2 mm / 5 m |
| centro del marker dal piano della faccia | 0.2 mm |
| triangoli / dimensione file | 200 000 / 8 MB |
| sporgenza di un pezzo appeso oltre la lamiera interna | 0.1 mm |

Il controllo verifica i dati, non le intenzioni meccaniche: un aggancio valido
ma sbagliato si vede solo dalle immagini di montaggio e dalla conferma del
cliente.

## 5. Pubblicare e verificare

`npm run catalog:publish` scrive:

```
public/catalog/
  current.json                     revisione in uso
  history.json                     pubblicazioni e rollback
  previews/<sha>.png               anteprime, una per contenuto di GLB
  revisions/<rev>/pointer.json     puntatore della revisione
  revisions/<rev>/index.json       elenco dei GLB con hash, ingombro, URL
  revisions/<rev>/manifest.json    manifest con il campo revision
  revisions/<rev>/report.json      rapporto del controllo
```

Lo stesso contenuto dà sempre la stessa revisione. Dopo la pubblicazione,
aprire l'applicazione: il catalogo mostra la revisione in uso; i prodotti
esclusi (GLB senza manifest e viceversa) sono elencati sopra il catalogo.

**Aggiungere un prodotto**: GLB nella cartella, voce nel manifest, controllo,
pubblicazione. Nessuna modifica al codice (test «publication is refused with
blocking errors… adding a product»).

**Aggiornare un prodotto**: sostituire il GLB e pubblicare. Le correzioni
scritte per il file precedente non si applicano più e il rapporto lo dice; i
progetti salvati restano validi finché i marker mantengono i nomi.

## 6. Revisioni e progetti salvati

Ogni progetto salva `catalog.revision`. All'apertura:

- stessa revisione: si apre;
- revisione diversa ma pubblicata: si apre con quella revisione;
- revisione non più disponibile: **non** si apre; l'utente può scegliere
  «Apri con la revisione corrente» e vede gli avvisi sui prodotti mancanti;
- nessuna revisione (progetti precedenti): si apre con quella corrente, con un
  avviso.

Rollback: `--rollback <rev>` rimette in uso una revisione pubblicata solo se
tutti i suoi GLB hanno ancora lo stesso hash. La cartella di riferimento ha una
sola copia di ogni file: il backend di produzione conserva i file di ogni
revisione (archivio per hash), così il rollback è sempre possibile.

## 7. API del catalogo (T24)

Sola lettura per l'applicazione; JSON UTF-8. I percorsi relativi nelle
risposte si risolvono rispetto all'URL della risposta.

| Richiesta | Risposta | Cache |
| --- | --- | --- |
| `GET /catalog/current.json` | `CatalogPointer`: `revision`, `index`, `manifest`, `report`, `publishedAt`, `summary` | `no-cache` |
| `GET /catalog/revisions/{rev}/pointer.json` | puntatore della revisione `{rev}` | immutabile |
| `GET …/index.json` | `CatalogIndex`: `version`, `revision`, `products[]`, `enclosures[]`; ogni voce `code`, `file`, `url`, `category`, `sha256`, `bytes`, `triangles`, `bounds`, `preview` | immutabile |
| `GET …/manifest.json` | manifest v2 con `revision` | immutabile |
| `GET …/report.json` | rapporto del controllo | immutabile |
| `GET {url}` | GLB, identificato dall'hash | immutabile |
| `GET {preview}` | PNG | immutabile |

Errori, come li vede il client (`loadCatalogRevision` → `CatalogRevisionError`):

| Caso | HTTP | `code` | Comportamento dell'applicazione |
| --- | --- | --- | --- |
| revisione inesistente | 404 | `unreachable` | messaggio «Catalogo non disponibile» o, per un progetto, scelta esplicita |
| risposta non JSON o non valida per lo schema | 200 | `invalid` | come sopra, con il campo non valido |
| puntatore, indice e manifest di revisioni diverse | 200 | `revision-mismatch` | rifiutata: mai un catalogo misto |
| GLB mancante | 404 sul file | — | il pezzo mostra l'errore del modello; gli altri restano utilizzabili |

Pubblicazione e rollback sono operazioni del backend, riservate a chi gestisce
il catalogo, e passano sempre dal controllo.

## 8. Correggere gli errori più comuni

| Codice | Intervento |
| --- | --- |
| `glb-unreadable` | riesportare il GLB |
| `code-duplicate` | rinominare uno dei file |
| `manifest-missing` / `asset-missing` | allineare cartella e manifest |
| `marker-duplicate` / `marker-malformed` | rinominare i marker `SNAP_<TIPO>__<NOME>` e riesportare |
| `point-missing` | aggiungere il marker o correggere `snapId`/`snapKind` |
| `reference-unknown` | correggere `compatibleWith` |
| `sample-invalid` / `sample-connections` | controllare posizioni dei marker e connettori sull'assieme indicato |
| `sheet-overlap` | il marker del pezzo non è sulla faccia della staffa |
| `correction-stale` | verificare il nuovo GLB e togliere la correzione |
| `marker-legacy` / `marker-off-surface` | alla prossima esportazione, marker con nome stabile centrati sulla superficie |
