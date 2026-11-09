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

## 3. Commit, push e merge dalla lavagna

Se la cartella aperta è un repository git, la barra in alto mostra il branch corrente e i pulsanti per le azioni più comuni, come fa Claude Code: **Commit**, **Push** e **Merge** nel branch principale. Così, quando gli agenti hanno finito, il lavoro si chiude senza passare dal terminale.

- Si attiva solo se c'è un repository (`git rev-parse` dalla cartella del progetto, anche se il `.git` sta in una cartella sopra).
- Accanto al branch: file modificati e commit avanti o indietro rispetto al remoto.
- **Commit:** elenco dei file modificati (lo stesso del panel Codice) con il diff, e un campo per il messaggio.
- **Push** e **Merge** chiedono sempre conferma e mostrano cosa stanno per fare (branch, commit, remoto).
- Usa il `git` del sistema con le sue credenziali: OpenPlancia non salva password né token.

Da decidere:

- Se il messaggio di commit lo può proporre una sessione Claude collegata, partendo dal diff.
- Cosa fare con i conflitti di merge: fermarsi e mostrarli nel panel Codice, oppure passarli a una sessione Claude.
- Se aggiungere anche "Apri PR" (con `gh`) per chi lavora su GitHub.
- Oggi OpenPlancia usa git solo in lettura (il diff del panel Codice). Questa sarebbe la prima scrittura: va tenuta separata e coperta da test con un repository vero.

## 4. Modalità studio: la chat tutor

Una chat laterale, apribile e allargabile sopra la lavagna, collegata a una sessione Claude che fa da tutor. Gli agenti lavorano sulla lavagna (per esempio un orchestratore che scrive il `.md`, uno per la ricerca web, uno per le slide) e nella chat lo studente chiede cosa è successo, come si è arrivati a un risultato, da dove viene un'informazione, o si fa spiegare un concetto passo per passo.

Resta uno strumento per chi sa architettare un flusso di agenti: Claude Code installato e la lavagna da costruire, come per il resto di OpenPlancia. Non è una chat generica per tutti.

- **Vede tutta la lavagna** in lettura, senza bisogno di frecce: panel, file e il lavoro degli agenti.
- **Spiega solo in base a quello che è stato fatto.** Non modifica i panel degli agenti e non dà loro ordini.
- **Legge il processo, non solo i risultati:** il registro delle attività, i messaggi tra agenti e le conversazioni delle sessioni (Claude Code le salva su disco e OpenPlancia conosce i `--session-id`). Un nuovo tool MCP, per esempio `read_agent_history`, le legge solo quando servono, partendo dal registro delle attività che è più corto.
- **Comportamento da tutor:** spiega per gradi, cita quale agente e quale fonte hanno prodotto un'informazione, fa domande di verifica invece di dare subito la risposta.
- **Chat grafica, come l'app desktop di Claude, non un terminale:** messaggi con il testo che arriva mentre Claude scrive, Markdown, formule e blocchi di codice, i tool usati mostrati compressi ("Ha letto Problem.md"), link cliccabili ai panel della lavagna e il campo per scrivere in basso.
- **Crea materiali di studio come panel nuovi** sulla lavagna (può creare, ma non toccare quelli degli agenti):
  - flashcard e quiz come JSON validato, mostrati da un panel nativo (carte da girare, punteggio, progressi), come già fa il panel Architettura;
  - schemi semplici in Mermaid dentro un file Markdown;
  - spiegazioni interattive e schemi complessi in HTML, dentro un panel isolato (sandbox, nessun accesso al disco, a Node o alla rete).

Si offre bene come template "Studio" (vedi punto 2): orchestratore, ricerca, slide e tutor già collegati.

Come parla con Claude: la chat avvia la CLI dell'utente in modalità dati, `claude -p --input-format stream-json --output-format stream-json`, con `--resume <session-id>` per la memoria tra le domande. Il processo resta aperto e le risposte arrivano in JSON, da cui l'app costruisce la chat (Markdown, formule, link ai panel). Stesso login, stessi hook e stesso server MCP delle altre sessioni. Senza richieste di permesso interattive, gli strumenti vanno dichiarati con `--allowedTools`: solo quelli di lettura e quello per creare i materiali. Le opzioni ci sono in Claude Code 2.1.312; resta da provare un giro completo con hook e MCP attivi.

Da decidere:

- Il formato delle conversazioni salvate da Claude Code non è documentato e può cambiare: va verificato prima di costruirci sopra, con un ripiego sul solo registro delle attività.
- Quanto contesto leggere per ogni domanda, per non consumare troppi token su lavagne grandi.

## Poi

- Pacchetti macOS firmati e notarizzati, così il primo avvio non chiede passaggi in più.
- Prove a mano su Windows e Linux. I pacchetti li costruisce la CI, ma finora l'app è stata provata a mano solo su macOS.
- Link di download nel README che non vanno aggiornati a ogni versione (nomi dei file senza versione e `releases/latest/download/`).

## Idee aperte

- Panel Design stile Figma.
- Ripresa automatica degli agenti all'apertura di un progetto (opzionale).
- "Riordina" negli schemi di architettura.
