# TODO

Le funzioni in programma dopo la v0.1.1, in ordine di priorità. La sezione "What's next" del [README](README.md) ne riassume le prime.

## 1. Riquadri e testo stile Excalidraw

Forme libere sulla lavagna, accanto ai panel: rettangoli, ellissi, note e testo semplice, con un colore di riempimento e del testo dentro. Servono per raggruppare i panel ("Backend", "Da rivedere"), lasciare annotazioni e disegnare schemi veloci senza aprire un panel Architettura.

- Strumenti nella barra a sinistra, con una scorciatoia come gli altri panel.
- Testo modificabile con doppio clic, dimensione e colore scelti da una piccola tavolozza.
- Ridimensionabili e spostabili come i panel. Un riquadro che contiene dei panel li sposta insieme a sé.
- Salvati in `.plancia/board.json` con gli altri elementi (nuova versione di `schemaVersion`, con migrazione).

Da decidere:

- Se Claude può leggere un riquadro con una freccia, come un panel Markdown, o se i riquadri sono solo per chi guarda la lavagna.
- Se usare il tratto "a mano" di Excalidraw (per esempio con rough.js) o forme pulite in linea con il resto dell'interfaccia.

## 2. Template riutilizzabili

Salvare una lavagna come template, con i suoi panel, le frecce e le sessioni Claude, e partire da lì per un nuovo progetto. Per esempio un planner, un implementatore e un revisore già collegati a un `PLAN.md` condiviso, pronti da usare in qualsiasi repository.

- "Salva come template" dalla lavagna aperta, con nome e descrizione.
- Dalla schermata iniziale, "Nuovo da template" su una cartella di progetto.
- Nel template entrano la disposizione, i tipi di panel, le frecce e i riquadri. Non entrano gli id delle sessioni Claude né la cronologia: ogni progetto parte con sessioni nuove.
- I percorsi dei file (`PLAN.md`, `docs/`) restano relativi alla cartella del progetto. Se un file non esiste, si crea vuoto o da un contenuto salvato nel template.

Da decidere:

- Dove salvarli: nella cartella dati dell'app (template personali) o in `.plancia/templates/` del progetto (condivisi con git). Forse entrambi.
- Se un template può portare con sé un prompt iniziale per ogni sessione Claude.

## Poi

- Pacchetti macOS firmati e notarizzati, così il primo avvio non chiede passaggi in più.
- Prove a mano su Windows e Linux. I pacchetti li costruisce la CI, ma finora l'app è stata provata a mano solo su macOS.
- Link di download nel README che non vanno aggiornati a ogni versione (nomi dei file senza versione e `releases/latest/download/`).

## Idee aperte

- Panel Design stile Figma.
- Ripresa automatica degli agenti all'apertura di un progetto (opzionale).
- "Riordina" negli schemi di architettura.
