# Contratto GLB e manifest del catalogo

Versione 2 · 5 novembre 2026. Formato dei file che il cliente consegna (GLB) e
che scriviamo insieme al cliente (manifest), letti dalla libreria senza codice
specifico per prodotto. Implementazione: `src/lib/io/productCatalog.ts`
(costruzione del catalogo), `src/lib/assembly/manifest.ts` (schema),
`src/lib/io/itemSnaps.ts` (marker), `src/lib/io/anchors.ts` (ancoraggi),
`src/lib/io/catalogCheck.ts` (controllo). Esempio reale:
[`catalog/manifest.json`](../catalog/manifest.json).

## 1. GLB (T06)

### Unità, assi, origine

| Regola | Prodotti | Veicoli |
| --- | --- | --- |
| Unità | metri, scala 1:1 | metri, scala 1:1 |
| Asse verticale | +Y | +Y |
| Origine | libera: il configuratore usa il centro del corpo visibile | centro del pianale |
| Orientamento | pezzi tra i fianchi: larghezza lungo X, fronte verso +Z; fianchi: profondità lungo X (dietro 0 → fronte), altezza Y, faccia esterna a Z = 0, gemello verso −Z | marcia lungo Z |

Un GLB non in metri si accetta solo con una correzione `scale` legata al file
(§ 5); il controllo del catalogo segnala ingombri sotto 2 mm o sopra 5 m.

### Nome e cartella

- Nome file = codice prodotto: `KDW40236.glb`.
- Una sottocartella per categoria (`MONTANTI/`, `ORIZZONTALI/`, `ANTINE/`,
  `ACCESSORI/`); i veicoli nella cartella principale o in `VEICOLI/`.
- L'id di catalogo è il codice normalizzato: minuscole, solo lettere e cifre
  (`PTBM-31.glb` → `ptbm31`). Due file che si normalizzano allo stesso id sono
  un errore bloccante (`code-duplicate`).

### Marker di aggancio

```
SNAP_<TIPO>__<NOME>        es. SNAP_FRONTALE__END_A, SNAP_SOVRAPPOSIZIONE__TESTA
```

- `<TIPO>`: famiglia di aggancio (`FRONTALE`, `POSTERIORE`, `LATERALE`,
  `TERRA`, `SOVRAPPOSIZIONE`, `APPOGGIO`…). Diventa il `kind`, in minuscolo.
- `<NOME>`: id del punto, unico nel file e uguale a ogni riesportazione. Diventa
  l'id, in minuscolo (`END_A` → `end_a`). Solo lettere, numeri e `_`.
- Il marker è un cubetto di circa 1 mm **centrato sulla superficie di
  contatto**, al centro del foro di fissaggio, su una faccia e non su uno
  spigolo. Tolleranza del controllo: 0.2 mm dal piano della faccia.
- Prodotti appesi ai fianchi: il marker sta sulla faccia della staffa che
  appoggia contro la lamiera, a entrambe le estremità.
- Fianchi forati: nessun marker sui fori; li genera la colonna di fori (§ 3).
- I nomi si leggono come scritti nel GLB, prima che il caricatore aggiunga
  `_1` ai nomi ripetuti: un nome ripetuto è un errore (`marker-duplicate`).
- Marker vecchi `SNAP_<TIPO>` / `SNAP_<TIPO>-N`: ancora letti, numerati
  nell'ordine del file (`frontale-1`, `frontale-2`…), e segnalati
  (`marker-legacy`): una riesportazione li rinumera.

### Regole e veicoli

- Regole nel nome del nodo: `RULE_MIRRORPAIR_D<mm>.<mm>…`,
  `RULE_AUTOSNAPGRID` (vedi [glb-conventions.md](glb-conventions.md)).
- Veicoli: un solido `Body_interior` che delimita il vano; un cubetto
  `anchor_<NOME>` per ogni ancoraggio a pavimento, appoggiato sul pianale: la
  posizione è il **centro della geometria** del cubetto, non l'origine del
  nodo; porte come nodi separati con nome stabile.

### Esportazione reale del cliente

Il controllo del catalogo gira sui GLB attuali del cliente (SolidWorks,
`public/models`): sono leggibili, in metri, con marker vecchi numerati e
cubetti appoggiati sulla faccia (centro 0.5 mm fuori). Il rapporto li elenca
(`marker-legacy`, `marker-off-surface`); le correzioni del manifest li rendono
utilizzabili. Una prima esportazione con i nomi `SNAP_<TIPO>__<NOME>` va
verificata con `npm run catalog:check` appena il cliente la fornisce.

## 2. Identità e revisioni (T07)

| Cosa | Regola |
| --- | --- |
| Prodotto | id = codice normalizzato; `code` nel manifest deve normalizzarsi al `catalogId` |
| Punto | id stabile dal nome del marker, dalla colonna (`<colonna>-<n>`) o dal manifest; unico nel prodotto |
| Connettore | id unico nel prodotto; i progetti salvati lo registrano in ogni collegamento |
| Schema manifest | `version: 2` (la libreria legge anche la 1, solo connettori) |
| Schema progetto | `version: 1`, più il campo facoltativo `catalog: { revision, enclosureId }` |
| Revisione del catalogo | `rev-<12 hex>`: hash di manifest e SHA-256 dei GLB; stesso contenuto, stessa revisione |
| Conservazione | ogni revisione pubblicata resta in `revisions/<id>/` con indice, manifest, rapporto; i GLB sono indicizzati per hash e il backend li conserva per revisione |

Un progetto si riapre con la revisione con cui è stato composto; se non è più
disponibile l'utente lo vede e decide (§ 6 di [gestione-catalogo.md](gestione-catalogo.md)).

## 3. Manifest (T08, T09)

```jsonc
{
  "version": 2,
  "revision": "rev-…",                      // scritto alla pubblicazione
  "categories": { "ANTINE": "Antine" },     // nome leggibile delle cartelle
  "products": [ /* § 3.1 */ ],
  "enclosures": [ /* § 3.3 */ ],
  "samples": [ /* § 3.4: assiemi del controllo */ ]
}
```

### 3.1 Prodotto

| Campo | Unità / frame | Significato |
| --- | --- | --- |
| `catalogId`, `code` | — | identità (§ 2) |
| `label`, `description`, `category`, `instructions[]` | — | testo per l'utente; `category` prevale sulla cartella |
| `connectors[]` | — | come e con chi si aggancia: `snapId`/`snapKind`, `compatibleWith`, `capacity`, `insertionDepth`, `insertionAxis`, `clearance`, `snapTolerance`, `bomComponents` |
| `colliders[]` | m, frame collider | volumi per collisioni e ingombro |
| `bom` | — | codice e descrizione in distinta |
| `points[]` | m, frame GLB | punti che il contratto tiene fuori dal GLB |
| `holeColumns[]` | m, frame GLB | colonne di fori (§ 3.2) |
| `mirrorPair` | frame GLB | `axis` verso il gemello, `distances` (m) che sostituiscono quelle del GLB |
| `bays[]` | m | campate (distanze della coppia) in cui il pezzo entra; assente = qualsiasi |
| `directions` | frame GLB | direzione di aggancio di marker del GLB, per id o tipo |
| `assetCorrections[]` | — | dati per un file preciso (§ 5) |
| `review` | — | `confirmed`, `by`, `date`, `notes`: conferma del cliente delle regole meccaniche |

Compatibilità, capacità, collider, tolleranze e distinta sono quelli della
versione 1, invariati.

### 3.2 Colonna di fori

```json
{ "id": "front", "kind": "frontale", "label": "Foro anteriore",
  "first": [0.363, 0.018, -0.017], "pitch": [0, 0.036, 0],
  "normal": [0, 0, -1],
  "sheet": { "outward": [1, 0, 0], "thickness": 0.0015 } }
```

| Parametro | Definizione |
| --- | --- |
| `first` | centro del **primo** foro sulla faccia **esterna** della lamiera, frame GLB, m. È l'origine della colonna |
| `pitch` | vettore da un foro al successivo: asse e verso della colonna, modulo = passo |
| `count` / `length` | numero di fori, oppure distanza massima del centro dell'ultimo foro da `first`; assenti = tutti i fori il cui centro sta dentro il corpo lungo `pitch` |
| id | `<id>-1` … `<id>-N` numerati da `first`: stabili finché `first` e `pitch` non cambiano |
| `normal` | direzione di aggancio di ogni foro, verso il pezzo che riceve |
| `sheet` | lamiera forata: i fori vengono spostati di `thickness` contro `outward`, sulla faccia **interna**, dove appoggiano le staffe |

Colonne anteriore e posteriore sono colonne separate, ciascuna con il proprio
`kind` (`frontale`, `posteriore`), il proprio `first` e il proprio `outward`
(verso l'esterno della propria lamiera).

### 3.3 Veicolo

`id`, `label`, `code`, `description`, `dimensions` (vano, m), `floor`
(pianale), `anchors[]`, `doors` (porte animate), `assetCorrections[]` con
`scale`, `dimensions`, `floor`, `anchors`; `review`. Vale ciò che il GLB non
porta: `Body_interior` e `anchor_<NOME>` nel GLB rendono superflui vano e
ancoraggi.

### 3.4 Assiemi campione

Passi `{ id, product, position?, yaw? }` (pezzo libero),
`{ id, product, point, on, at }` (aggancio), `{ id, twinOf, distance }`
(gemello), più `expectConnections`. Il controllo li compone con la stessa
matematica dell'editor e li valida; non è una funzione dell'applicazione.

## 4. Coordinate e precedenze (T10)

| Frame | Origine e assi | Dove si usa |
| --- | --- | --- |
| GLB | quelli del file | `points`, `holeColumns`, `mirrorPair.axis`, `directions`, correzioni |
| Collider (prodotto) | centro del corpo visibile (marker esclusi), assi del GLB, metri dopo la scala | `CatalogItem.snapPoints`, `colliders`, `clearance` |
| Scena | metri, Y in alto, base del pezzo in `position` | progetti salvati |

Precedenze, applicate **una volta sola** dalla funzione generica
`prepareProductAsset`:

1. Punti del manifest (`holeColumns`, `points`, punti delle correzioni)
   sostituiscono i marker del GLB con lo stesso id e i marker dei tipi delle
   colonne e delle correzioni.
2. I marker restanti del GLB valgono così come sono; la loro direzione è quella
   di `directions` se dichiarata, altrimenti quella dedotta dalla faccia su cui
   stanno. Senza faccia univoca e senza direzione il controllo segnala
   `direction-ambiguous`.
3. `auto-snap-grid` (fori dedotti dalla geometria) solo dove dichiarato.

Arretramenti: l'unico è quello della lamiera, `sheet.thickness` contro
`sheet.outward`, applicato ai fori. I pezzi appesi non arretrano: il loro
marker è già sulla faccia della staffa. Così la stessa correzione non può
essere applicata due volte; il controllo `sheet-overlap` e il test sui GLB
reali lo verificano.

## 5. Correzioni per asset precedenti (T11)

Quanto serve solo perché un GLB attuale non rispetta il contratto sta in
`assetCorrections`, con l'hash del file (almeno 12 caratteri) e il motivo:

```json
"assetCorrections": [{
  "asset": "b7a051daae02be89",
  "reason": "Marker numerati, su una sola estremità, cubetto appoggiato sulla faccia…",
  "points": [ { "id": "end-a", "kind": "frontale", "position": [-0.49, 0.0119, 0.17925], "normal": [-1, 0, 0] } ]
}]
```

Vale solo per quel file. Quando il cliente riesporta il GLB, la correzione non
si applica più e il controllo lo segnala (`correction-stale`): il nuovo file
deve rispettare il contratto. I requisiti dei nuovi GLB sono quelli del § 1.

Prodotti pilota descritti in `catalog/manifest.json`: fianco `ysi03036`
(colonne di fori anteriore e posteriore, coppia specchiata, correzione per i
punti di sovrapposizione), cassetto `kdw40236` (campata 1014, correzione per le
due estremità sulla faccia della staffa), antina `kld41000` (idem). Viteria in
distinta (`connectors[].bomComponents`): **codici da fornire dal cliente**; il
formato è pronto, i dati no.
