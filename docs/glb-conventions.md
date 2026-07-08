# Convenzioni GLB — nodi funzione (rule nodes)

Specifica per dichiarare, dentro il GLB di un prodotto, **funzioni parametriche**
che il configuratore esegue a runtime. La logica vive nel codice
(`src/lib/scene/`); il GLB dichiara solo *quale* regola si applica e *con quali
parametri*.

La convenzione è basata esclusivamente su **glTF `extras`** (→
`Object3D.userData` in three.js). L'export SolidWorks non scrive extras: i GLB
vanno post-processati (script `gltf-transform` / iniezione JSON) oppure
rifiniti in Blender prima della pubblicazione nel catalogo.

Parsing runtime: `src/lib/io/rules.ts` (parallelo a `anchors.ts` per gli
anchor dell'allestimento).

## 1. Nodo regola

Un nodo qualsiasi della gerarchia del prodotto — Empty o mesh marker (i marker
vengono nascosti a runtime) — con `extras`:

```json
{
  "kind": "rule",
  "rule": "<id-regola>",
  "params": { }
}
```

- `kind: "rule"` — marca il nodo (parallelo a `kind: "anchor"`).
- `rule` — id della regola implementata nel codice, kebab-case
  (es. `mirror-pair`).
- `params` — oggetto JSON libero; lo schema dipende dalla regola.
  **Le lunghezze nei params sono sempre metri reali**, indipendenti dalla
  scala di export del GLB e dal campo `scale` del catalogo.

Semantica geometrica comune:

- **Posizione mondo del nodo** = punto di riferimento della regola.
- **Asse +X locale del nodo** = direzione della regola.
  `params.axis: [x, y, z]` la sovrascrive (come `normal` negli anchor).

Regole sconosciute **non sono un errore**: vengono ignorate e il prodotto
resta utilizzabile senza la funzione.

## 2. Regola `mirror-pair` (coppia specchiata)

Prodotti come **KSI12836** esistono solo in coppia: due istanze identiche,
specchiate, a distanze discrete (es. 30 / 60 / 90 cm), formano un blocco unico.

### Dichiarazione

```json
{
  "kind": "rule",
  "rule": "mirror-pair",
  "params": {
    "distances": [0.30, 0.60, 0.90]
  }
}
```

**L'asse di accoppiamento lo dichiara il cliente nel GLB**, in uno dei due
modi (vale per tutte le regole, v. §1):

- orientando il nodo in CAD così che il suo **asse +X locale** punti verso il
  gemello, oppure
- con `params.axis: [x, y, z]` negli extras (override esplicito, comodo in
  post-processing quando il CAD non controlla l'orientamento del marker).

Esempio reale (nodo iniettato in `public/models/KSI12836.glb`, figlio del
nodo prodotto): il KSI si accoppia **frontalmente** verso −Z, quindi il nodo
sta sulla faccia a −Z e dichiara `axis: [0, 0, -1]`:

```json
{
  "name": "RULE_MIRRORPAIR",
  "translation": [0.18, 0.267, -0.18],
  "extras": {
    "kind": "rule",
    "rule": "mirror-pair",
    "params": { "distances": [0.3, 0.6, 0.9], "axis": [0, 0, -1] }
  }
}
```

### Semantica geometrica

- Posizionare il nodo sulla **faccia di accoppiamento** del prodotto (quella
  rivolta verso il gemello); l'asse della regola (+X locale o `params.axis`)
  punta verso il gemello.
- **Distanza `d`** = distanza tra i punti di riferimento delle due istanze,
  misurata lungo l'asse. Con il nodo sulla faccia di accoppiamento, `d`
  coincide con la luce libera tra i due prodotti.
- Il gemello è la **stessa risorsa GLB, specchiata** rispetto al piano
  perpendicolare all'asse posto a `d/2` dal punto di riferimento. Il flip è
  applicato lungo la componente orizzontale dominante dell'asse (X = coppia
  affiancata, Z = coppia fronte-a-fronte); assi obliqui non sono supportati.

```
   istanza A            istanza B (specchiata)
  ┌────────┐ P·———— d ————·P ┌────────┐
  └────────┘      piano       └────────┘
             di specchiatura
              (a d/2 da P)
```

### Comportamento runtime (implementato)

- `io/rules.ts` estrae le regole al load del GLB e nasconde i nodi marker;
  finiscono nello store (`itemRules`, per `catalogId`).
- L'Inspector mostra i pulsanti distanza (`30 cm / 60 cm / 90 cm` dai
  `params.distances`) per gli item il cui GLB dichiara `mirror-pair`.
  Click → crea il gemello specchiato (`mirrored: true` sul PlacedItem,
  reso con scale −1 lungo l'asse di specchiatura + materiali DoubleSide).
  Ri-click su un'altra
  distanza riposiziona il gemello. «Scollega coppia» rimuove il gemello.
- Le due istanze sono legate nel project JSON da constraint reciproci
  `{ "type": "mirrorPair", "target": "<id-partner>", "distance": 0.3 }`.
- La coppia è un **blocco unico**: trascinare una metà trascina l'altra
  (sync live durante il drag e al commit, gizmo incluso); eliminare una metà
  elimina entrambe. La matematica sta in `src/lib/scene/mirrorPair.ts`.

## 3. Punti di snap prodotto (`SNAP_*`)

Controparte lato-prodotto degli anchor dell'allestimento: durante il drag,
il configuratore aggancia un punto di snap del prodotto su un anchor
dell'enclosure (oltre a centro e 4 vertici inferiori del collider).
Parsing: `src/lib/io/itemSnaps.ts`.

Dichiarazione, in uno dei due modi:

1. **Nome nodo** `SNAP_<ID>` (case-insensitive) — convenzione già in uso nei
   file Sincro esportati da SolidWorks. Il suffisso istanza `-N` viene
   scartato: `SNAP_TERRA-7` → id `terra`.
2. **extras** `{ "kind": "snap", "id": "<id>" }` (id opzionale, fallback al
   nome nodo).

Il punto è il **centro della geometria** del nodo marker (SolidWorks esporta
i componenti con pivot all'origine e geometria "cotta", quindi l'origine del
nodo non è significativa); se il nodo è un Empty vale la sua posizione.
I marker vengono nascosti a runtime.

Nel project JSON il constraint registra quale punto è agganciato:
`{ "type": "snapToAnchor", "target": "<anchor>", "point": "terra" }`
(in alternativa `corner: 0-3` per i vertici del collider; assente = centro).

## 4. Regola `auto-snap-grid`

Per piastre forate regolari, il GLB può dichiarare solo che serve una griglia
snap; il configuratore ricava i centri dei fori dalla geometria triangolata e
li pubblica come normali punti prodotto (`auto-grid-r<r>-c<c>`).

Dichiarazione minima:

```json
{
  "kind": "rule",
  "rule": "auto-snap-grid",
  "params": {}
}
```

Il detector scansiona automaticamente tutte le sei facce esterne del modello,
cerca rettangoli/perforazioni ripetute, e genera i centri sulla faccia relativa.
Così vengono inclusi anche fori laterali/superiori/inferiori. Parametri
opzionali:

```json
{
  "normal": [0, 0, 1],
  "minHoleSize": 0.006,
  "maxHoleSize": 0.018,
  "planeTolerance": 0.001,
  "vertexTolerance": 0.00001
}
```

- `normal` forza una singola faccia (`+` = lato max dell'asse dominante, `-` =
  lato min); se assente vengono scansionate tutte le facce.
- `faces: "primary"` ripristina il vecchio comportamento: una sola faccia,
  scelta sullo spessore minore del modello.
- `minHoleSize` / `maxHoleSize` filtrano la dimensione del foro rettangolare
  cercato, in metri.
- Le tolleranze servono solo per compensare export CAD non perfettamente
  allineati.

Per `public/models/KSI12836.glb` questa regola trova una griglia regolare di
fori sulla faccia frontale e produce gli snap point senza coordinate manuali.

## 5. Aggiungere nuove regole

1. Definire l'id (`kebab-case`) e lo schema `params`.
2. Implementare la logica nel codice (estrazione già generica in
   `io/rules.ts`; aggiungere il modulo in `src/lib/scene/`).
3. Documentare qui: extras, semantica geometrica del nodo (cosa significano
   posizione e asse), comportamento runtime.
