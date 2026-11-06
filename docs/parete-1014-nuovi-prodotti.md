# Parete 1014 — profilo del fianco e nuovi prodotti

Come i pezzi della parete Syncro 1014 (preventivo 99003819) si agganciano ai
fori dei fianchi, perché un pezzo può «coprire» il profilo del fianco e cosa
fare quando si aggiunge un prodotto alla parete. Da novembre 2026 tutto ciò è
dato del catalogo, non codice.

File coinvolti:

- [`catalog/manifest.json`](../catalog/manifest.json) — fianchi (colonne di
  fori), pezzi appesi, correzioni dei GLB attuali, assiemi campione.
- [`src/lib/io/productCatalog.ts`](../src/lib/io/productCatalog.ts) —
  costruzione generica del catalogo (`holeColumnPositions`,
  `resolveProductPoints`).
- [`src/lib/io/catalogCheck.ts`](../src/lib/io/catalogCheck.ts) — controllo
  `sheet-overlap` sugli assiemi campione.
- [`tests/tasca-wall.test.mjs`](../tests/tasca-wall.test.mjs) — test sui GLB
  reali e composizione manuale confrontata con
  [`tests/fixtures/tasca-99003819`](../tests/fixtures/tasca-99003819/README.md).

## Il problema

Sulle antine KLD 41000 e KUD 40900 il profilo frontale del fianco non si
vedeva: al suo posto compariva una piastra chiara con i fori, cioè la staffa
laterale dell'antina.

Il fianco YSI è un profilo a C. La faccia frontale è una lamiera spessa
**1.5 mm** forata ogni 36 mm. Le estremità dei pezzi (staffe delle antine,
guide dei cassetti, piastre degli angolari) entrano nel profilo e si
avvitano **dietro** quella lamiera.

```
            vista dall'alto, fianco destro

   campata                 profilo a C del fianco
  ─────────────┐        ┌──────────────────────────┐
               │        │                          │
   pezzo       │ staffa │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│ ← lamiera frontale 1.5 mm
               └────────┤                          │   (faccia esterna = fronte del fianco)
                        │                          │
                 ↑ la staffa deve stare QUI, dietro la lamiera
```

## La causa

Il configuratore aggancia un pezzo facendo coincidere due punti:

- il punto del **foro del fianco**, che sta sulla faccia esterna della lamiera
  (il centro del marker è 0.5 mm fuori dalla faccia);
- il marker `SNAP_FRONTALE` del **pezzo**, letto dal CAD.

Su molti GLB il marker del pezzo è sulla faccia della staffa. Facendo
coincidere i due punti, la faccia della staffa finisce **sullo stesso piano**
della faccia esterna del fianco. Due superfici sovrapposte si contendono la
profondità (z-fighting) e il renderer disegna la staffa sopra il fianco.

Misure sui GLB prima della correzione (distanza tra la parte più avanzata del
pezzo dentro il profilo e la faccia del fianco; per non vedersi serve almeno
−1.50 mm):

| Prodotto | Parte nel profilo | Distanza |
| --- | --- | --- |
| KLD 41000 antina inferiore | staffe `ZLC00900`, piastre `ABC00001` | +0.04 mm |
| KUD 40900 antina superiore | staffe `ZUC00400` | 0.00 mm |
| XLA 40400 angolare leggero | corpo `A-XLA40400` | +0.01 mm |
| KMA 40100 angolare | piastre `ABC00001S` | −0.05 mm |
| KCP 40531 ripiano | frontale `A-XDS40231` | −0.01 mm |
| KDW cassetti | fissaggi `ADF_IFERM8` / guide `YAD00100` | −0.10 / −0.80 mm |

I CAD non seguono una convenzione unica: sulle antine il marker è sulla
faccia della staffa, sui cassetti 1.2 mm davanti. Per questo i cassetti
sembravano a posto (la guida era dentro la lamiera, coperta), mentre il
piccolo fissaggio `ADF_IFERM8` era comunque a filo.

## La soluzione

I CAD attuali mettono il marker come un cubetto da 1 mm **appoggiato** sulla
faccia (centro 0.5 mm fuori): sui fianchi davanti alla lamiera, sui pezzi
davanti alla faccia della staffa. La regola di produzione è diversa e uguale
per tutti:

- **fianchi**: i fori li genera la colonna di fori del manifest
  (`holeColumns`, passo 36 mm, asse a 17 mm dalla faccia esterna) sulla faccia
  **interna** della lamiera: `sheet: { outward, thickness: 0.0015 }`;
- **pezzi appesi**: il punto di contatto è sulla faccia della staffa che
  appoggia contro la lamiera. Per i GLB attuali lo dichiara una correzione
  legata all'hash del file: il marker CAD meno 0.5 mm, sull'asse dei fori
  (490 mm dal centro), alle due estremità;
- **cassettiera** (`appoggio`): appoggia sulla testa dei fianchi, nessun
  arretramento.

A montaggio fatto la staffa coincide con la faccia interna della lamiera. La
geometria risultante è la stessa della correzione provvisoria della demo
(marker CAD 1 mm dietro la faccia esterna): la parete composta a mano coincide
con il riferimento entro 0.2 mm. L'unico arretramento è quello della lamiera,
sui fori: non può essere applicato due volte.

## I controlli automatici

| Dove | Cosa controlla |
| --- | --- |
| controllo del catalogo, `sheet-overlap` | su ogni assieme campione del manifest, nessuna mesh di un pezzo appeso che entra nell'ingombro del fianco supera la faccia interna della lamiera (0.1 mm) |
| `tests/tasca-wall.test.mjs` | colonne di fori sulla faccia interna; ogni marker CAD corretto una sola volta e sulla griglia; regola della coppia; campata 1014; controllo del catalogo sui GLB reali; composizione manuale della parete uguale al riferimento; salvataggio e riapertura |
| `tests/catalog.test.mjs` | un pezzo che sporge di 1 mm oltre la lamiera viene fermato |

Il controllo non usa elenchi di prodotti: vale per ogni pezzo agganciato a una
colonna di fori con `sheet`.

## Aggiungere un nuovo prodotto alla parete

1. **GLB** in `public/models/<CATEGORIA>/<CODICE>.glb`, larghezza su X e
   fronte verso +Z, con i marker `SNAP_FRONTALE__END_A` e
   `SNAP_FRONTALE__END_B` **centrati** sulla faccia della staffa, al centro del
   foro, alle due estremità.
2. **Manifest**: una voce con `label`, `description`, `category`,
   `instructions`, `bays: [1.014]`, `directions: { "end_a": [-1, 0, 0],
   "end_b": [1, 0, 0] }` (la faccia della staffa guarda in avanti, l'aggancio è
   verso il fianco), connettore `bay-end` compatibile con `side-front-hole`,
   collider e distinta. Nessuna correzione: il GLB segue il contratto.
3. **Assieme campione** in `samples`, come `fianco-cassetto`.
4. `npm run build:lib && npm run catalog:check`: errori e avvisi indicano file,
   punto e intervento. Poi `npm run catalog:publish` e prova nell'applicazione:
   fianco, coppia a 101.4 cm, pezzo, «Aggancia nella scena».

Un pezzo modellato diversamente (come l'XLA, in lunghezza su Z) dichiara le
proprie direzioni nel manifest. Le immagini di
[dettagli-montaggio.md](dettagli-montaggio.md) si rigenerano con
`npm run catalog:images`.

## Regola per chi prepara i CAD

> Nell'assieme CAD, con il pezzo montato, il centro del marker del pezzo sta
> sulla faccia della staffa che tocca la lamiera del fianco, al centro del
> foro.

Quando un GLB attuale viene riesportato così, la sua correzione nel manifest
non si applica più (è legata all'hash del file) e il controllo lo segnala
(`correction-stale`): va tolta dal manifest, senza toccare il codice.

## Cosa non è coperto

- Il controllo guarda gli ingombri delle mesh dentro l'ingombro del fianco;
  non sostituisce una verifica CAD delle interferenze reali.
- Quale parte della staffa appoggia sulla lamiera (per i cassetti l'inserto
  filettato) va confermata dal cliente: vedi
  [dettagli-montaggio.md](dettagli-montaggio.md).
