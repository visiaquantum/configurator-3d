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

Sono i punti di giunzione del prodotto. Servono a due cose:

- agganciare il prodotto a un **anchor dell'allestimento** (es. il pavimento);
- agganciare il prodotto a **un altro prodotto** (montante → orizzontale →
  accessorio).

Parsing: `src/lib/io/itemSnaps.ts`. Regole di accoppiamento e matematica:
`src/lib/scene/mating.ts`.

### Dichiarazione

1. **Nome nodo** `SNAP_<TIPO>` (case-insensitive) — convenzione già in uso nei
   file Sincro esportati da SolidWorks. **È il canale da usare**: l'export CAD
   del cliente non scrive extras.
2. **extras** `{ "kind": "snap", "id": "<tipo>" }` (alternativa legacy, se il GLB
   viene post-processato). Per dichiarare un identificativo stabile separato
   dalla famiglia usare `{ "kind": "snap", "id": "faccia-destra", "snapKind": "laterale", "normal": [1, 0, 0] }`.
   `normal` è facoltativa, deve essere un vettore finito non nullo nel frame
   locale del nodo e viene trasformata e normalizzata durante l'estrazione.

### `kind` e `id`

Il suffisso del nome è il **kind**, cioè la famiglia di giunzione. Ogni
suffisso di istanza viene scartato — sia quello di SolidWorks (`-7`) sia
quello che three.js aggiunge quando un GLB ripete un nome nodo (`_1`):

```
SNAP_TERRA-7      → kind terra
SNAP_TERRA-7_1    → kind terra
SNAP_FRONTALE-2   → kind frontale
```

L'**id** è ciò che finisce nel project JSON. Un kind presente una volta sola
tiene l'id nudo (`terra`); un kind ripetuto viene numerato nell'ordine di
attraversamento (`frontale-1` … `frontale-10`). Così ogni punto è
indirizzabile: `KIT01` porta dieci marker `frontale` e senza numerazione
sarebbero tutti lo stesso punto.

> **Per chi prepara i GLB**: non serve inventare nomi univoci. Ripetere
> `SNAP_FRONTALE` su ogni posizione utile è corretto e voluto — ci pensa il
> configuratore a numerarli.

La numerazione dipende dall'ordine dei nodi. Per cataloghi aggiornati nel tempo
e progetti salvati, preferire gli ID espliciti con `snapKind` oppure
`catalog.snapPoints`: questi mantengono i riferimenti anche se il CAD riordina
i marker.

### Tabella di accoppiamento

Chi configura sceglie **esplicitamente** il punto di destinazione, quindi
questa tabella non decide cosa è lecito: filtra e ordina le proposte. Un
accoppiamento non elencato resta possibile spuntando «mostra anche i punti non
compatibili» nell'Inspector.

| kind | si accoppia con | significato |
|---|---|---|
| `terra` | anchor dell'allestimento | base d'appoggio a pavimento |
| `laterale` | `laterale` | montanti affiancati |
| `sovrapposizione` | `sovrapposizione` | montante sopra montante |
| `frontale` | `frontale`, `foro` | facciata: orizzontali e accessori |
| `foro` | `frontale`, `foro` | centro foro generato da `auto-snap-grid` |
| `origine` | — | solo riferimento, non accoppia |

La tabella vive in `MATING_RULES` (`src/lib/scene/mating.ts`) ed è esportata
dalla libreria.

### Posizione e normale

Il punto è il **centro della geometria** del nodo marker (SolidWorks esporta i
componenti con pivot all'origine e geometria "cotta", quindi l'origine del nodo
non è significativa); se il nodo è un Empty vale la sua posizione. I marker
vengono nascosti a runtime.

La **normale** è la direzione uscente della faccia del bounding box su cui il
punto appoggia, dedotta geometricamente (i marker non portano una rotazione
utilizzabile). Un marker su uno spigolo tocca più facce contemporaneamente: in
quel caso la normale non viene dichiarata, invece di tirare a indovinare.
Un `normal` esplicito negli extras prevale sulla deduzione geometrica. Il
bounding box usato per la deduzione esclude i sottoalberi dei marker.

### Constraint nel project JSON

Aggancio a un anchor dell'allestimento:

```json
{ "type": "snapToAnchor", "target": "<anchor>", "point": "terra" }
```

(in alternativa `corner: 0-3` per i vertici del collider; assente = centro).

Aggancio a un altro prodotto:

```json
{ "type": "snapToItem", "target": "<id-item>", "point": "frontale-2", "targetPoint": "auto-grid-xmax-r4-c1" }
```

`point` è il punto **di questo** item, `targetPoint` quello dell'item di
destinazione. Muovere l'item di destinazione trascina tutti gli item agganciati,
ricorsivamente (`resolveSnappedChildren`). Trascinare a mano l'item agganciato
rompe il legame.

### Incastro: orientamento e compenetrazione

Agganciare non è solo traslare. Due pezzi si **incastrano** quando le rispettive
facce di accoppiamento si guardano: il configuratore ruota il pezzo attorno a Y
finché la normale del suo punto punta esattamente contro quella del punto di
destinazione (`yawToMate`). Le rotazioni provate sono i quarti di giro, gli
unici che questo configuratore committa.

Se una delle due facce è orizzontale — normale verso l'alto o il basso, come i
fori sul piano di una mensola — nessuna rotazione attorno a Y può allinearle: il
pezzo mantiene la rotazione che ha e viene solo traslato.

L'orientamento del figlio viene **ricalcolato** dalle due facce a ogni
spostamento, non accumulato come delta: ruotare il montante ruota le mensole
agganciate, e ripetere l'operazione non fa derivare l'assieme.

Due pezzi incastrati possono condividere volume **solo** nel volume di
clearance dichiarato dal connettore nel manifest tecnico. La validazione non
esclude mai in blocco le coppie legate: un'intersezione fuori da quella zona
resta una collisione rossa e blocca la BOM. La preview di drag comunica subito
se il giunto è ammesso.

## 4. Regola `auto-snap-grid` (fori come punti di snap)

Per le lamiere forate il GLB dichiara solo che serve la rilevazione dei fori;
il configuratore ne ricava i centri dalla geometria e li pubblica come normali
punti prodotto, di kind `foro` (id `auto-grid-<faccia>-r<r>-c<c>`).

### Come attivarla

Tre canali, in ordine di preferenza:

1. **Nodo con extras** — `{ "kind": "rule", "rule": "auto-snap-grid", "params": {} }`.
2. **Nodo con solo il nome** `RULE_AUTOSNAPGRID` (i suffissi `-N` / `_N` sono
   ignorati). Serve per gli export CAD che non scrivono extras: basta
   aggiungere un Empty con quel nome.
3. **Voce di catalogo** — `{ id, label, glbUrl, autoSnapGrid: true }`, quando
   il GLB non è modificabile affatto. Può anche passare i parametri, ad esempio
   `autoSnapGrid: { meshNameIncludes: ["ZDH00200"], normals: [[0, 0, -1], [0, 0, 1]] }`
   per analizzare solo le due facciate laterali delle staffe.

Quando un'interfaccia meccanica è nota e deve restare invariata tra gli export
CAD, preferire invece `snapPoints` nel catalogo: gli id e le coordinate sono
nel frame locale del collider e diventano la mappa certificata del prodotto.
Per XDS40231KM02 la mappa dei fori è al momento disabilitata in attesa delle
coordinate certificate. La griglia forata inferiore non è un'interfaccia di
montaggio e non genera snap.

### Come funziona la rilevazione

Per ogni faccia esterna si prendono i triangoli che giacciono su quel piano e
si contano gli usi di ciascuno spigolo. Uno spigolo usato da due triangoli è
interno; usato **una volta sola** delimita la superficie. Concatenando gli
spigoli di bordo si ottengono contorni chiusi semplici. La loro inclusione
reciproca distingue le sagome esterne dai fori: un piccolo poligono pieno
isolato non è un foro. Solo i contorni interni con dimensioni ammesse diventano
punti di snap; sottoalberi nascosti non vengono analizzati.

> La versione precedente cercava «quattro vertici complanari che formano un
> rettangolo». Quel test scatta su qualunque tassellatura regolare: su un
> profilo estruso da 52k triangoli produceva ~1800 fori inesistenti su una
> faccia sola, e il costo era quadratico sul numero di coordinate distinte —
> un accessorio da 8,8k triangoli non terminava. La ricerca dei contorni è
> lineare sui triangoli e riporta solo geometria che è davvero un foro.

Misure sul catalogo attuale:

| GLB | triangoli | fori | tempo |
|---|---|---|---|
| `YSI12836` (montante) | 8.836 | 42 | 11 ms |
| `XDS40231KM02` (orizzontale) | 52.472 | nessun foro automatico (mappa in revisione) | — |
| `KIT01` | 132.352 | 30 | 22 ms |
| `PTBM-31` (accessorio) | 8.883 | 0 | 7 ms |

### Parametri opzionali

```json
{
  "normal": [0, 0, 1],
  "normals": [[-1, 0, 0], [1, 0, 0]],
  "meshNameIncludes": ["ZDH00200"],
  "faces": "primary",
  "minHoleSize": 0.003,
  "maxHoleSize": 0.030,
  "planeTolerance": 0.001,
  "vertexTolerance": 0.00001
}
```

- `normal` forza una singola faccia (`+` = lato max dell'asse dominante, `-` =
  lato min); se assente vengono scansionate tutte e sei.
- `normals` è la variante multi-faccia: limita la rilevazione alle facce con
  le normali indicate e prevale su `normal`. Usarla quando soltanto alcuni
  fori del prodotto sono punti d'innesto.
- `meshNameIncludes` limita l'analisi ai mesh il cui nome contiene uno dei
  valori indicati. È utile per staffe o pannelli laterali che non coincidono
  con il bounding box esterno dell'intero prodotto.
- `faces: "primary"` limita alle due facce dell'asse più sottile, cioè i lati
  piatti di una lamiera.
- `minHoleSize` / `maxHoleSize` sono la finestra dimensionale del foro, in
  metri, applicata al suo bounding box su entrambi gli assi nel piano. È
  anche ciò che scarta la sagoma esterna del pezzo, troppo grande per
  rientrarci.
- Le tolleranze compensano export CAD non perfettamente allineati
  (`planeTolerance`) e vertici non saldati (`vertexTolerance`).

## 5. Aggiungere nuove regole

1. Definire l'id (`kebab-case`) e lo schema `params`.
2. Implementare la logica nel codice (estrazione già generica in
   `io/rules.ts`; aggiungere il modulo in `src/lib/scene/`).
3. Documentare qui: extras, semantica geometrica del nodo (cosa significano
   posizione e asse), comportamento runtime.
