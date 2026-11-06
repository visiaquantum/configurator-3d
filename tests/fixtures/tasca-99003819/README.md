# Riferimento della parete Tasca · preventivo 99003819

Caso di prova conservato per il passaggio alla produzione (fase 1 di
[task-passaggio-produzione.md](../../../docs/task-passaggio-produzione.md)).
Serve a confrontare la parete composta a mano con il catalogo di produzione
con quella che la demo generava. **Non alimenta il percorso di produzione:**
l'applicazione e la libreria non importano nulla da questa cartella
(`tests/production-path.test.mjs` lo verifica).

| File | Contenuto |
| --- | --- |
| [`legacyDemo.ts`](legacyDemo.ts) | Catalogo scritto a mano e generatore della parete della demo (ex `src/tascaWall.ts`), invariati salvo gli import |
| [`reference-project.json`](reference-project.json) | Progetto di riferimento: 14 pezzi, 22 agganci, veicolo IVECO Daily |
| [`reference-bom.json`](reference-bom.json) | Distinta del riferimento |
| [`assets.json`](assets.json) | SHA-256 dei GLB usati: il confronto vale per questa revisione degli asset |
| [`../../../docs/montaggio/`](../../../docs/montaggio/) | Immagini dei dettagli di montaggio (T04) |

Revisione degli asset: i GLB di `public/models` con gli hash di `assets.json`;
revisione del catalogo pubblicata con lo stesso contenuto:
`public/catalog/current.json` (`rev-…`, calcolata dal contenuto di GLB e manifest).

## T01 · Inventario della parete

Una campata da 1014 mm (faccia esterna – faccia esterna), due livelli di
fianchi in coppia specchiata. Quote in mm dal pianale del vano (ancoraggio a
12 mm); i fori dei fianchi sono a 18 mm dalla base e poi ogni 36 mm.

| Codice | Descrizione | Q.tà | Dove | Foro | Altezza foro |
| --- | --- | --- | --- | --- | --- |
| YSI03036 | Fianco 1080 × 360 | 2 | coppia inferiore, campata 1014 | — | base 12 |
| YSI01131 | Fianco 396 × 310 | 2 | coppia superiore, sovrapposta | `stack-bottom` → `stack-top` | base 1092 |
| KLD41000 | Antina inferiore 1014 × 360 | 1 | fianchi inferiori | `front-11` | 390 |
| KDW40636 | Cassetto h208 | 1 | fianchi inferiori | `front-14` | 498 |
| KDW40436 | Cassetto h136 | 1 | fianchi inferiori | `front-19` | 678 |
| KDW40336 | Cassetto h100 | 1 | fianchi inferiori | `front-23` | 822 |
| KDW40236 | Cassetto h64 | 1 | fianchi inferiori | `front-25` | 894 |
| XLA40400 | Angolare leggero 1014 × 144 | 1 | fianchi inferiori | `front-27` | 966 |
| KMA40100 | Angolare rinforzato | 2 | fianchi superiori: anteriore e posteriore | `front-2`, `back-2` | 1146 |
| KUD40900 | Antina superiore 1014 × 324 | 1 | fianchi superiori | `front-8` | 1362 |
| KDU40426KD080 | Cassettiera MultiBox | 1 | testa dei fianchi superiori | `top` | 1488 |

Collegamenti (22): ogni pezzo con le due estremità, `end-a` sul fianco esterno
e `end-b` sul gemello (l'angolare posteriore al contrario, perché ruotato verso
la parete); i due fianchi superiori sui due inferiori. Elenco completo in
`reference-project.json` → `connections`.

## T02 · Censimento delle correzioni della demo

Ogni valore specifico dei prodotti che stava nel codice della demo, perché
c'era e dove sta ora. «Correzione» = `assetCorrections` del manifest, legata
all'hash del GLB: vale solo per quel file e viene segnalata quando il file
cambia. Nessuno di questi valori è rimasto nel codice applicativo.

| # | Valore (dove era) | Prodotto | Motivo | Destinazione |
| --- | --- | --- | --- | --- |
| 1 | `PITCH = 0.036` (`tascaWall.ts`) | fianchi YSI | passo dei fori | manifest: `holeColumns[].pitch` |
| 2 | `HOLE_INSET = 0.017` | fianchi YSI | asse dei fori 17 mm dalla faccia esterna | manifest: `holeColumns[].first` |
| 3 | `FLANGE_THICKNESS = 0.0015` e arretramento dei pezzi | fianchi YSI, tutti i pezzi appesi | le staffe stanno dietro la lamiera | manifest: `holeColumns[].sheet` (fori sulla faccia interna, funzione generica `holeColumnPositions`) |
| 4 | colonne `front-N` / `back-N` generate (`sidePanel`) | fianchi YSI | il GLB ha un solo `SNAP_FRONTALE` | manifest: colonne `front` e `back`, stessi id |
| 5 | `mirrorPair.axis = [0,0,-1]` | fianchi YSI | il CAD nomina la regola ma non la orienta | manifest: `mirrorPair.axis` |
| 6 | `stack-bottom`, `stack-top`, `top` | fianchi YSI | marker di sovrapposizione e appoggio assenti o non stabili | correzione del GLB; per i nuovi GLB: marker `SNAP_SOVRAPPOSIZIONE__BASE`, `__TESTA`, `SNAP_APPOGGIO__TESTA` |
| 7 | `SIDE_THICKNESS`, `size`, centri dei corpi | tutti | ingombro scritto a mano | GLB: ingombro calcolato dai file (indice del catalogo) |
| 8 | `fromGlb(center)` | tutti | conversione GLB → collider scritta per prodotto | funzione generica `resolveProductPoints` |
| 9 | `END_OFFSET`, `mount [y, z]` di `bayPart` | cassetti, ripiano, angolari, antine | marker su una sola estremità, cubetto appoggiato sulla faccia (centro 0.5 mm fuori) | correzione del GLB con le due estremità sulla faccia della staffa; per i nuovi GLB: marker centrati sulla staffa a entrambe le estremità |
| 10 | `XLA_CENTER`, `XLA_FACE` | XLA40400 | modello in lunghezza su Z | correzione del GLB |
| 11 | appoggi `appoggio` della cassettiera | KDU40426KD080 | il GLB ha solo `SNAP_TERRA` | correzione del GLB |
| 12 | `BAY_WIDTH = 1.014` | serie 1014 | campata dei pezzi | manifest: `bays: [1.014]`; distanze della coppia dal nome `RULE_MIRRORPAIR_D…` del GLB |
| 13 | `IVECO_ENCLOSURE` (vano, ancoraggi) | IVECO Daily | il GLB non ha `Body_interior` né `anchor_*` | manifest dei veicoli: correzione del GLB IVECO |
| 14 | `TASCA_WALL`, `buildTascaWall`, `tascaWallContext` | parete | generatore del solo preventivo | tolto dalla produzione; conservato qui come riferimento |
| 15 | `MODEL_SCALE = 10`, pianale e ancoraggi FIAT (`App.tsx`) | FIAT NDC 40H2 | esportato a 0.1×, ancoraggi 20 cm sopra il pianale | manifest dei veicoli: correzione del GLB FIAT |
| 16 | punti `shelf-*`, `rail-*` di YSI12836 (`App.tsx`) | YSI12836 | marker solo al piede; altezze da KIT01, traverse −1.3 mm, normali verso l'interno | correzione del GLB; per i nuovi GLB: un marker per altezza e `directions` nel manifest |
| 17 | `end-a`/`end-b` di XDS40236KM02 e XHA40100 (`App.tsx`) | KIT 01 | marker numerati in ordine di lettura | correzione del GLB; per i nuovi GLB: `SNAP_<TIPO>__<NOME>` |
| 18 | `size` di XDS40231KM02, PTBM-31, KIT01 (`App.tsx`) | — | ingombro scritto a mano | GLB |
| 19 | gruppi, etichette e veicoli (`App.tsx`) | tutti | interfaccia della demo | manifest: `label`, `category`, `description`, `instructions`, `enclosures` |
| 20 | anteprime in `public/catalog/previews/<id>.png` | tutti | fatte a mano | generate dai GLB alla pubblicazione (`<sha>.png`) |
| 21 | «Parete preventivo 99003819», «Registra demo KIT» | — | pulsanti dimostrativi | tolti |

## T03 · Riferimento conservato

GLB (hash in `assets.json`), manifest (`catalog/manifest.json` e la sua copia
pubblicata), progetto e distinta (questi file). `reference-project.json` è
l'output del generatore della demo: il test
«the reference wall is still what the former demo generator produced»
garantisce che non cambi senza che lo si veda.

## T05 · Regressioni conservate

| Test di `tascaWall.ts` | Dove è coperto ora |
| --- | --- |
| every manifest connector of the wall resolves to a hydrated snap point | controllo del catalogo, `point-missing` (test «the catalogue check passes on the real folder») |
| catalogue sizes are the visible bodies of the GLBs | «the production catalogue carries the whole wall»: l'ingombro viene dai GLB |
| every CAD mounting marker lands on the hole grid of a catalogue seat | «every hung part bears on the sheet with its CAD marker corrected once» |
| (diff non committato) every part reaching into the side profile sits behind its front flange | controllo `sheet-overlap` sugli assiemi campione, sui GLB reali e su un caso sintetico che sporge di 1 mm |
| the side panels read their mirror rule from the node name | stesso test, con l'asse dal manifest |
| the 1014 bay spacing seats every part of the series | stesso test, sul catalogo di produzione |
| the quoted wall composes, bolts at both ends and validates inside the van | composizione manuale con i comandi dell'interfaccia, confrontata con `reference-project.json` |
| the demo builds the same wall without loading a single GLB | non più necessario (il generatore non è in produzione); sostituito dal controllo che il riferimento resti invariato |
