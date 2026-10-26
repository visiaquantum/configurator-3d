# Esempio React per il gestionale

Progetto React 19 + TypeScript + Vite indipendente. Usa esclusivamente gli export
pubblici di `@visiaquantum/configurator-3d`, installato dal pacchetto incluso in
`vendor/configurator-3d.tgz`. Non importa i sorgenti o l'interfaccia della demo.

## Avvio per il cliente

Richiede Node.js 24 e npm. Dalla cartella di questo esempio:

```sh
npm ci
npm run dev
```

Aprire l'indirizzo mostrato nel terminale. Non occorrono token GitHub, un backend
o credenziali di pubblicazione: libreria e modelli sono già inclusi nella consegna.
Le dipendenze npm vanno scaricate durante l'installazione.

Per compilare e provare la versione di produzione:

```sh
npm run build
npm run preview
```

## Preparazione dal repository della libreria

Questo passaggio è per chi prepara la consegna, non per il cliente. Dalla radice
del repository, dopo `npm ci`:

```sh
npm run example:prepare
cd examples/react-integration
npm install
npm run build
npm run dev
```

`example:prepare` compila la libreria, crea il suo pacchetto in `vendor/`, copia
i quattro GLB esistenti in `public/models/` e verifica catalogo, modelli,
manifest, connessioni e distinta dell'assieme. Rigenerarlo dopo modifiche alla
libreria; reinstallare poi il pacchetto nell'esempio con
`npm install ./vendor/configurator-3d.tgz`.

`vendor/`, `public/models/`, `node_modules/` e `dist/` sono generati e non
versionati. Consegnare tutta la cartella preparata, inclusi `vendor/`,
`public/models/` e `package-lock.json`; escludere `node_modules/` e `dist/`.

## Cosa provare

1. Aggiungere un prodotto dalla colonna Componenti.
2. Aprire **Apri assieme completo**: due montanti, due ripiani e due traverse,
   con otto connessioni già risolte. Attendere il caricamento dei GLB: la
   configurazione deve risultare valida.
3. Usare **Salva** nella barra del configuratore, poi **Nuovo progetto** e
   **Riapri salvataggio**. Il salvataggio di esempio usa il browser corrente.
4. Usare **Scarica JSON** e **Importa JSON** per trasferire la configurazione.
5. Aprire **Esporta** nel configuratore e provare PNG, GLB e distinta PDF.
   La distinta del progetto completo deve contenere due unità per ciascuno
   dei tre prodotti.
6. Per l'aggancio manuale: tasto destro su un pezzo → **Aggancia nella scena**,
   poi scegliere il punto iniziale, il destinatario e il punto finale.

Il primo avvio mostra un progetto vuoto: l'assieme completo si apre con il suo
pulsante. Gli export richiedono il caricamento dei modelli; il PDF richiede
anche l'assenza di errori bloccanti.

## File da integrare o sostituire

| File | Contenuto |
| --- | --- |
| `src/App.tsx` | Pagina host, pulsanti catalogo, salvataggio e importazione |
| `src/data.ts` | Caricamento e validazione dei dati, risoluzione degli URL |
| `public/catalog/catalog.json` | Catalogo versione 1 con dimensioni, scala e snap |
| `public/catalog/assembly-manifest.json` | Connettori, compatibilità, collider e distinta |
| `public/catalog/project.json` | Progetto completo, inclusi posizioni e otto collegamenti |
| `public/models/` | Vano FIAT, montante YSI12836, ripiano XDS40236KM02 e traversa XHA40100 |

I modelli sono quelli già presenti nel repository. Il vano usa scala 10,
i prodotti scala 1. Posizioni runtime e snap dichiarati sono in metri,
l'asse verticale è Y e le rotazioni sono in radianti. Le dimensioni del catalogo
escludono i marker; vengono verificate sui GLB con tolleranza di 2 mm.
Gli snap di montaggio dichiarati nel catalogo sono gli stessi della demo
verificata; includono le tolleranze necessarie alle geometrie dei prodotti.

Questo manifest comprende solo i tre prodotti dell'esempio: i connettori
`upright-shelf-seat` ↔ `shelf-end` e `upright-rail-hook` ↔ `rail-end`.
ID prodotto e ID snap devono restare coerenti con i progetti salvati.
Le clearance ammettono le intersezioni previste dagli agganci del telaio.
Questi dati dimostrano l'integrazione con il catalogo pilota; le geometrie di
nuovi prodotti richiedono proprie misure e regole verificate.

## Collegamento al gestionale

- In `saveProject` sostituire `localStorage.setItem` con la chiamata alla
  propria API, associando il progetto a cliente, preventivo o ordine.
- Passare il JSON restituito dall'API a `openProject`: viene validato con
  `parseProject` e applicato con `ref.current.setProject`.
- `onChange` fornisce uno snapshot a ogni modifica. L'esempio lo usa per il
  contatore; per l'autosalvataggio introdurre un ritardo e gestire gli errori API.
- Passare il proprio catalogo e manifest come oggetti validati o URL JSON.
  I dati iniziali devono mantenere riferimenti stabili: non ricreare l'oggetto
  `enclosure` a ogni aggiornamento dell'interfaccia.
- Il contenitore del canvas deve avere un'altezza. I CSS del configuratore
  sono già inclusi; `styles.css` riguarda solo la pagina host.

Per utilizzare un CDN, sostituire `glbUrl` con URL HTTPS completi e consentire
il dominio del gestionale tramite CORS. `src/data.ts` conserva gli URL completi
e risolve quelli relativi rispetto alla base dell'app. Gli URL completi salvati
nel JSON devono restare raggiungibili; per URL firmati scaduti o cambi di dominio,
aggiornarli prima di riaprire il progetto.

Per una pubblicazione sotto una sottocartella, impostare `base` in
`vite.config.ts`, ad esempio `base: '/gestionale/configuratore/'`.
L'esempio non necessita dell'HDR della demo e usa le riflessioni procedurali
incluse nella libreria.

## Verifica dei dati dalla radice del repository

```sh
npm run verify:integration
```

Il controllo legge i GLB dell'esempio, confronta le dimensioni, verifica i
connettori, valida il progetto con sei componenti e otto connessioni e controlla
la distinta 2+2+2. Verifica anche il rifiuto di un ripiano spostato e di
connessioni mancanti. Eseguire prima `npm run example:prepare` per copiare gli asset.
