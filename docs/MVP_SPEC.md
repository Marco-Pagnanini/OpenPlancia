# Plancia — Specifica MVP

> Documento di lavoro per Claude Code. Leggilo tutto prima di scrivere codice.
> Implementa **una milestone alla volta** (sezione 10), nell'ordine indicato, e fermati a fine milestone per la verifica.
> "Plancia" è un nome provvisorio. **Non** usare "Claude Code" nel nome dell'app, nelle icone o nella UI come se fosse un prodotto Anthropic.

---

## 1. Cos'è

Un'app desktop per sviluppatori: una **lavagna infinita** su cui si posizionano **panel**. Alcuni panel sono terminali in cui gira Claude Code, altri contengono dati (file markdown, schemi di architettura, codice).

L'idea centrale: **le frecce tra i panel sono il contesto**. Collegare un panel a un terminale Claude dà a Claude accesso a quel panel, con una semantica precisa basata sulla **direzione** della freccia:

| Freccia | Significato |
|---|---|
| Panel → Terminale Claude | Claude **legge** il panel |
| Terminale Claude → Panel | Claude **scrive** nel panel |
| Entrambe le direzioni | Claude legge **e** scrive |

Obiettivo secondario, ma altrettanto importante: rendere **visibile** cosa fa l'agente (stato, tool usati, file toccati, letture e scritture sulle frecce), invece di una black box.

### Obiettivi dell'MVP
1. Canvas infinito con panel spostabili e ridimensionabili, salvato su disco.
2. Panel **Terminale** (shell o Claude Code) funzionante come un terminale vero.
3. Panel **Markdown** legato a un file reale (es. `AGENTS.md`).
4. Panel **Architettura** (nodi e relazioni) serializzato in JSON con schema.
5. Panel **Codice** in sola visualizzazione, che segue automaticamente i file modificati dagli agenti.
6. **Frecce di lettura/scrittura** tra panel e terminali Claude, applicate davvero (non solo grafiche).
7. **Trasparenza**: stato dell'agente, timeline delle attività, ispettore della freccia.

### Fuori dall'MVP (non implementare, ma non precludere)
- Panel **Design** stile Figma.
- Frecce **Terminale ↔ Terminale** (multi-agente). Nell'MVP la connessione viene rifiutata con un messaggio "in arrivo".
- Collaborazione multi-utente, cloud, account, telemetria.
- Auto-update, firma e notarizzazione dei binari.

---

## 2. Stack

Tutto in **TypeScript strict**, un solo linguaggio tra main e renderer.

| Area | Scelta |
|---|---|
| Shell desktop | Electron (ultima stable) |
| Build | electron-vite |
| Packaging | electron-builder |
| UI | React + TypeScript |
| Canvas | `@xyflow/react` (React Flow) |
| Stato renderer | zustand |
| Stile | Tailwind CSS |
| Terminale UI | `@xterm/xterm` + addon `fit`, `webgl`, `web-links` |
| PTY | `node-pty` (rebuild per Electron con `electron-builder install-app-deps`) |
| Editor codice/markdown | Monaco (`@monaco-editor/react`), anche `DiffEditor` |
| Preview markdown | `react-markdown` + `remark-gfm` |
| Layout automatico nodi architettura | `@dagrejs/dagre` |
| Validazione | `zod` (+ `zod-to-json-schema` per esporre lo schema a Claude) |
| Server MCP | `@modelcontextprotocol/sdk`, trasporto Streamable HTTP |
| File watching | `chokidar` |
| Test | vitest (+ Testing Library per i componenti critici) |

Usa le ultime versioni stabili e controlla la documentazione corrente di ciascun pacchetto. Non aggiungere dipendenze fuori da questa lista senza un motivo scritto nel commit.

---

## 3. Architettura dei processi

```
┌──────────────────────────── Electron main (Node) ────────────────────────────┐
│ WorkspaceService   apre la cartella progetto, carica/salva .plancia/board.json│
│ BoardStore         FONTE DI VERITÀ: panel, frecce, versioni dei contenuti     │
│ AccessService      calcola i permessi read/write dalle frecce                 │
│ PtyService         node-pty: crea, scrive, ridimensiona, chiude i PTY         │
│ ClaudeLauncher     genera config per terminale e lancia `claude`              │
│ LocalServer        HTTP su 127.0.0.1:<porta casuale>                          │
│   ├─ /mcp/:terminalId/:token     server MCP "plancia"                         │
│   └─ /hooks/:terminalId/:token   riceve gli hook di Claude Code               │
│ ActivityLog        eventi per terminale e per freccia (in memoria + su disco) │
│ FileWatcher        chokidar sui file dei panel                                │
│ GitService         `git show HEAD:<path>` per i diff                          │
└──────────────┬────────────────────────────────────────────────────────────────┘
               │ IPC tipizzato (contextBridge, preload minimale)
┌──────────────┴──────────── Renderer (React) ─────────────────────────────────┐
│ Canvas (React Flow), panel, ispettori. Specchio dello stato del main.        │
│ Manda "intenti" al main, riceve eventi di stato. Nessun accesso a Node.      │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Regole non negoziabili
- **Il main è la fonte di verità** per panel, frecce e contenuti, perché server MCP e hook devono leggerli anche quando il renderer non è pronto. Il renderer non modifica mai lo stato in locale senza passare dal main.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` dove possibile. Il preload espone solo un'API tipizzata e stretta (`window.plancia.*`).
- Il server locale ascolta **solo su `127.0.0.1`**. Ogni terminale ha un token casuale (32 byte) che va nel **path** dell'URL (non solo negli header).
- Tutti i percorsi di file passano da una funzione `resolveInWorkspace()` che rifiuta qualunque path fuori dalla cartella del progetto (path traversal, symlink che escono).
- Tipi e schemi condivisi stanno in `src/shared/` e sono importati da main e renderer.

---

## 4. Workspace e persistenza

L'utente apre una **cartella progetto** (di solito un repo). Plancia salva lì:

```
<progetto>/
  .plancia/
    board.json              # panel, posizioni, dimensioni, frecce
    panels/
      <panelId>.arch.json   # contenuto dei panel Architettura
  AGENTS.md                 # esempio: i panel Markdown puntano a file reali del repo
```

- `board.json` è JSON leggibile e versionabile. Includi `schemaVersion` per future migrazioni.
- I file di runtime con token (config MCP, settings per terminale) vanno in `app.getPath('userData')/run/`, **mai** nel repo.
- Alla riapertura il canvas viene ripristinato. I terminali **non** vengono riavviati da soli: ogni terminale Claude mostra un pulsante "Riprendi sessione" che lancia `claude --resume <sessionId>`.

---

## 5. Modello dati

Da definire in `src/shared/types.ts` con gli schemi zod corrispondenti in `src/shared/schemas.ts`.

```ts
type PanelType = 'terminal' | 'markdown' | 'architecture' | 'code';

interface PanelBase {
  id: string;                 // es. "md-3f2a"
  type: PanelType;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  version: number;            // +1 a ogni modifica del contenuto (utente o Claude)
  updatedAt: string;          // ISO
}

interface TerminalPanel extends PanelBase {
  type: 'terminal';
  mode: 'shell' | 'claude';
  cwd: string;                // relativo alla root del workspace
  claudeSessionId?: string;   // UUID passato con --session-id
  status: AgentStatus;        // solo runtime, non persistito
}

type AgentStatus = 'not-started' | 'idle' | 'working' | 'needs-input' | 'exited';

interface MarkdownPanel extends PanelBase {
  type: 'markdown';
  filePath: string;           // relativo alla root, es. "AGENTS.md"
}

interface ArchitecturePanel extends PanelBase {
  type: 'architecture';
  // il contenuto sta in .plancia/panels/<id>.arch.json (ArchitectureDoc)
}

interface CodePanel extends PanelBase {
  type: 'code';
  follow: 'all-agents' | { terminalId: string };
  pinnedFile?: string;        // file aperto manualmente dall'utente
}

interface Connection {
  id: string;
  source: string;             // panelId
  target: string;             // panelId
  createdAt: string;
}
```

### Documento Architettura

```ts
type ArchNodeKind =
  | 'service' | 'database' | 'queue' | 'api' | 'client'
  | 'external' | 'storage' | 'other';

interface ArchNode {
  id: string;                 // slug stabile, es. "auth"
  kind: ArchNodeKind;
  label: string;
  tech?: string;              // es. "Postgres", "Go"
  notes?: string;
  position?: { x: number; y: number };  // assente = layout automatico
}

interface ArchEdge {
  id: string;
  from: string;               // ArchNode.id
  to: string;
  label?: string;             // es. "JWT verify"
  protocol?: string;          // es. "HTTP", "gRPC", "AMQP"
}

interface ArchitectureDoc {
  schemaVersion: 1;
  title: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
}
```

Quando il documento viene dato a Claude, **le posizioni vengono rimosse** (sono rumore). Quando Claude scrive, i nodi senza posizione vengono disposti con dagre vicino ai nodi collegati, senza spostare quelli esistenti.

---

## 6. Regole delle connessioni

Implementale in `AccessService` come **funzioni pure** con test unitari completi. È il cuore del prodotto.

### Connessioni ammesse

| Sorgente → Destinazione | Ammessa | Effetto |
|---|:-:|---|
| Markdown → Terminale Claude | ✅ | Claude legge il markdown |
| Terminale Claude → Markdown | ✅ | Claude scrive il markdown |
| Architettura → Terminale Claude | ✅ | Claude legge l'architettura |
| Terminale Claude → Architettura | ✅ | Claude scrive l'architettura |
| Qualsiasi → Codice / Codice → Qualsiasi | ❌ | Il panel Codice non ha handle: segue gli agenti da solo |
| Qualsiasi ↔ Terminale `shell` | ❌ | Solo i terminali in modalità `claude` sono collegabili |
| Terminale Claude ↔ Terminale Claude | ❌ (MVP) | Tooltip: "Multi-agente: in arrivo" |
| Panel dati ↔ Panel dati | ❌ (MVP) | |

Non sono ammesse connessioni duplicate (stessa sorgente e destinazione).

### Calcolo dell'accesso

```ts
type Access = { read: boolean; write: boolean };

function accessFor(terminalId: string, panelId: string, connections: Connection[]): Access {
  return {
    read:  connections.some(c => c.source === panelId    && c.target === terminalId),
    write: connections.some(c => c.source === terminalId && c.target === panelId),
  };
}
```

L'accesso viene calcolato **al momento di ogni richiesta** (tool MCP o hook), mai salvato in cache. Aggiungere o togliere una freccia ha effetto immediato, senza riavviare Claude.

### Resa grafica
- Freccia di **lettura**: blu, punta verso il terminale.
- Freccia di **scrittura**: ambra, punta verso il panel.
- Lettura + scrittura tra la stessa coppia: mostrale come **un'unica freccia viola a due punte** (due `Connection` nel modello, un solo edge visuale).
- Una freccia usata negli ultimi 3 secondi si **anima** (tratteggio in movimento) e mostra una piccola etichetta "letto" o "scritto".
- Sul terminale Claude, un badge riassume le connessioni attive (es. `📥 2  📤 1`).

---

## 7. Integrazione con Claude Code

### 7.1 Avvio di un terminale Claude

`ClaudeLauncher` prepara per ogni terminale due file in `userData/run/<terminalId>/` e avvia `claude` dentro il PTY:

```bash
claude \
  --session-id <uuid generato dall'app> \
  --name "<titolo del panel>" \
  --mcp-config <userData>/run/<terminalId>/mcp.json \
  --settings <userData>/run/<terminalId>/settings.json \
  --append-system-prompt-file <userData>/run/plancia-system.md
```

- `--session-id` collega in modo certo gli eventi degli hook (`session_id`) al panel.
- **Non** usare `--strict-mcp-config`: i server MCP dell'utente devono restare disponibili.
- **PATH**: un'app avviata dal Finder o dal menu non eredita il PATH della shell. Avvia il comando tramite la shell di login dell'utente (`$SHELL -l -c "<comando>"` su macOS/Linux; su Windows risolvi `claude.cmd`). Se `claude` non si trova, mostra nel panel un errore chiaro con il link all'installazione.
- All'avvio dell'app esegui `claude --version` e salvalo. Mostralo nelle impostazioni.

**`mcp.json`** (token nel path: alcune versioni hanno avuto problemi con gli header sui server HTTP):

```json
{
  "mcpServers": {
    "plancia": {
      "type": "http",
      "url": "http://127.0.0.1:<PORT>/mcp/<terminalId>/<token>"
    }
  }
}
```

**`settings.json`**: hook verso il server locale e permessi per i tool di Plancia:

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:<PORT>/hooks/<terminalId>/<token>", "timeout": 5 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "http", "url": "…stesso URL…", "timeout": 5 }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "http", "url": "…", "timeout": 5 }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "http", "url": "…", "timeout": 5 }] }],
    "Notification":     [{ "hooks": [{ "type": "http", "url": "…", "timeout": 5 }] }],
    "Stop":             [{ "hooks": [{ "type": "http", "url": "…", "timeout": 5 }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "http", "url": "…", "timeout": 5 }] }]
  },
  "permissions": {
    "allow": [
      "mcp__plancia__list_panels",
      "mcp__plancia__read_panel",
      "mcp__plancia__write_panel",
      "mcp__plancia__get_panel_schema"
    ]
  }
}
```

I tool di Plancia sono pre-approvati perché **la freccia stessa è il consenso dell'utente**, e l'accesso viene comunque verificato lato server a ogni chiamata.

> ⚠️ **Da verificare all'inizio della M3** con la documentazione corrente (`https://code.claude.com/docs/en/hooks`, `…/cli-reference`, `…/settings`):
> 1. che gli hook passati con `--settings` si **aggiungano** a quelli dell'utente invece di sostituirli. Se li sostituiscono, documentalo e trova un'alternativa (es. unire gli hook dell'utente nel file generato);
> 2. che la versione installata supporti gli hook `type: "http"`. Se non li supporta, usa un hook `command` che esegue un piccolo script Node incluso nell'app (`resources/plancia-hook.js`) che legge lo stdin e fa POST all'URL, restituendo la risposta su stdout.

### 7.2 Endpoint degli hook

Un solo endpoint per terminale. Il tipo di evento si legge da `hook_event_name` nel body JSON. Risposte:
- default: **2xx con body vuoto**, in meno di 100 ms. Un errore di Plancia non deve mai bloccare Claude (gli hook HTTP con errore non bloccano, salvo `onFailure: "block"`, da non usare).
- per iniettare contesto o negare un'azione, 2xx con un JSON secondo lo schema degli hook (vedi sotto).

| Evento | Uso in Plancia |
|---|---|
| `SessionStart` | stato → `idle`. Risponde con il **manifesto** dei panel collegati (`additionalContext`). |
| `UserPromptSubmit` | stato → `working`. Inietta il manifesto **solo se è cambiato** dall'ultima iniezione (sezione 7.4). |
| `PreToolUse` | stato `working` + tool corrente nel badge. **Protezione dei panel** (sezione 7.5). |
| `PostToolUse` | timeline attività; se `tool_name` ∈ {`Write`, `Edit`, `MultiEdit`, `NotebookEdit`}, aggiunge il file al feed del panel Codice (path in `tool_input.file_path`, da verificare). |
| `Notification` | se è una richiesta di permesso o un'attesa input → stato `needs-input` (badge evidente + notifica di sistema se la finestra non ha il focus). |
| `Stop` | stato → `idle`; salva `last_assistant_message` nella timeline. |
| `SessionEnd` | stato → `exited`. |

### 7.3 Server MCP `plancia`

Un server MCP per tutti i terminali; il terminale chiamante si ricava da `:terminalId` nell'URL e il token va verificato. Ogni chiamata viene registrata nell'`ActivityLog` e anima la freccia corrispondente.

| Tool | Input | Comportamento |
|---|---|---|
| `list_panels` | — | Elenca i panel collegati a questo terminale: `id`, `type`, `title`, `access`, `version`, `updatedAt`, e `filePath` per i markdown. |
| `read_panel` | `{ panelId }` | Richiede `access.read`. Markdown: testo del file. Architettura: `ArchitectureDoc` senza posizioni. Restituisce anche `version`. |
| `write_panel` | `{ panelId, baseVersion, content, mode? }` | Richiede `access.write`. Markdown: `mode` = `"replace"` (default) o `"append"`, `content` = testo. Architettura: `content` = `ArchitectureDoc`, validato con zod; se non valido restituisce gli errori in modo leggibile. Se `baseVersion` ≠ versione corrente → errore di conflitto con la versione attuale, così Claude rilegge e riprova. |
| `get_panel_schema` | `{ type: "architecture" }` | JSON Schema dell'`ArchitectureDoc` (da `zod-to-json-schema`). |

Errori sempre espliciti e utili, ad esempio:
`"Accesso negato: il panel 'AGENTS.md' è collegato a questo terminale in sola lettura. L'utente deve aggiungere una freccia Terminale → Panel per consentire la scrittura."`

### 7.4 Manifesto e contenuto automatico

Il **manifesto** è un testo breve, scritto come fatti e non come ordini (come raccomanda la documentazione degli hook), iniettato con `hookSpecificOutput.additionalContext`:

```
Plancia — panel collegati a questa sessione:
- md-3f2a "AGENTS.md" (markdown, file AGENTS.md) · accesso: lettura · versione 7
- arch-91c0 "Backend v1" (architecture) · accesso: lettura e scrittura · versione 3
I contenuti si leggono con mcp__plancia__read_panel e si modificano con mcp__plancia__write_panel.

=== AGENTS.md (versione 7) ===
<contenuto completo del file>
```

Regole:
- **Contenuto inline**: per i panel con accesso in lettura, includi il contenuto completo nel manifesto se l'intero testo resta sotto **9.000 caratteri** (il limite per stringa di `additionalContext` è 10.000). È il comportamento atteso dall'utente: collego `AGENTS.md` e Claude lo vede senza doverlo chiedere. Se lo spazio non basta, includi i panel in ordine di dimensione crescente e indica gli altri come "disponibili via read_panel".
- `SessionStart`: inietta sempre il manifesto, se esiste almeno una connessione.
- `UserPromptSubmit`: inietta solo se, dall'ultima iniezione per quel terminale, è cambiato l'insieme delle connessioni o la `version` di un panel leggibile. In quel caso apri il manifesto con una riga che dice cosa è cambiato (es. `Modificato dall'ultimo messaggio: AGENTS.md (v6 → v7); nuova connessione: Backend v1`).
- Quando l'utente crea una freccia, mostra un toast: "Claude vedrà questo collegamento al prossimo messaggio".

`plancia-system.md` (passato con `--append-system-prompt-file`) spiega in 5-6 righe cos'è Plancia, cosa sono i panel collegati e che i tool `mcp__plancia__*` sono l'unico modo corretto per modificare architetture e panel markdown collegati.

### 7.5 Protezione dei panel (le frecce valgono anche per i tool nativi)

Un panel Markdown è un file vero, quindi Claude potrebbe modificarlo con `Write`/`Edit` aggirando le frecce. Nel `PreToolUse`:
- se `tool_name` ∈ {`Write`, `Edit`, `MultiEdit`} e il file di destinazione corrisponde al `filePath` di un panel Markdown, consenti **solo se** questo terminale ha accesso in scrittura a quel panel. Altrimenti rispondi con `hookSpecificOutput.permissionDecision: "deny"` e un `permissionDecisionReason` chiaro (stesso testo dell'errore MCP).
- qualunque scrittura con quei tool dentro `.plancia/` viene negata: le architetture si modificano solo con `write_panel`, così vengono validate.
- Le modifiche fatte via `Bash` non sono intercettabili in modo affidabile: è un limite noto, da documentare nel README, non da risolvere nell'MVP.

Una scrittura riuscita (via `write_panel` o via `Edit` con permesso) aggiorna il panel in tempo reale tramite il FileWatcher, incrementa `version` e crea una voce di **annullamento** (la versione precedente resta in memoria, ultime 20 per panel).

---

## 8. I panel

Comportamento comune: header con icona, titolo modificabile e menu (rinomina, duplica, elimina). Il trascinamento del panel avviene **solo dall'header**; il contenuto ha le classi `nodrag nowheel nopan` di React Flow, così mouse e rotellina arrivano al contenuto. Doppio clic sull'header → **modalità focus**: il panel si apre a schermo pieno sopra il canvas a scala 100%, `Esc` per tornare.

### 8.1 Terminale
- Crea: "Nuovo terminale" o "Nuovo Claude". Un terminale `shell` può essere convertito in `claude` dal menu (ne avvia uno nuovo).
- xterm.js con addon `fit` (ridimensionamento al resize del panel → `pty.resize`), `web-links`, tema scuro coerente con l'app.
- **WebGL**: Chromium limita il numero di contesti WebGL per pagina. Usa il renderer WebGL solo per il terminale con focus e per quelli in modalità focus; gli altri usano il renderer DOM. Gestisci la perdita del contesto ricadendo sul DOM.
- Testo leggibile a qualunque zoom: sotto il 60% di zoom il contenuto del terminale viene sostituito da un'anteprima (ultime righe in testo semplice + stato), per evitare testo sfocato e costi di rendering.
- Header del terminale Claude: badge di stato (`idle` grigio, `working` blu pulsante, `needs-input` arancione, `exited` rosso), tool corrente, badge delle connessioni, pulsante "Attività".
- Eliminare il panel chiude il PTY (con conferma se Claude sta lavorando).

### 8.2 Markdown
- Crea: "Nuovo file markdown" (chiede nome e percorso, crea il file) oppure "Apri markdown" (sceglie un `.md` esistente nel workspace).
- Due viste con toggle: **Modifica** (Monaco, linguaggio markdown) e **Anteprima** (react-markdown + GFM). Default: anteprima.
- Salvataggio automatico con debounce di 500 ms. Ogni salvataggio incrementa `version`.
- FileWatcher: se il file cambia fuori dall'app, il panel si aggiorna. Se l'utente ha modifiche non salvate, mostra un avviso invece di sovrascrivere.
- Quando Claude scrive: il panel lampeggia brevemente, compare una barra "Modificato da <titolo terminale> · Annulla".

### 8.3 Architettura
- Nel canvas il panel mostra un'**anteprima** del diagramma (SVG statico, non interattivo).
- La modifica avviene in **modalità focus**, con un'istanza React Flow dedicata (evita di annidare un React Flow interattivo dentro un nodo del canvas).
- Editor: aggiungi nodo (scegli `kind`), modifica etichetta, `tech`, note; collega nodi; etichetta le relazioni; elimina. Icona e colore per `kind`.
- Pulsante "Vedi JSON": mostra in sola lettura l'`ArchitectureDoc` esattamente come lo riceve Claude.
- Quando Claude scrive: nodi e relazioni aggiunti vengono evidenziati per qualche secondo; quelli rimossi spariscono con una dissolvenza.

### 8.4 Codice (sola visualizzazione)
- Nessun handle di connessione.
- `follow: "all-agents"` (default) oppure un terminale specifico (menu a tendina).
- Elenco dei file modificati dagli agenti (dal `PostToolUse`), il più recente in alto, con il terminale che l'ha toccato e l'orario.
- Selezionando un file: Monaco in sola lettura, oppure **diff** rispetto a `HEAD` (`git show HEAD:<path>`; se il repo non è git o il file è nuovo, mostra solo il contenuto).
- Si aggiorna in tempo reale quando il file cambia.
- L'utente può anche aprire manualmente qualunque file del workspace (`pinnedFile`).

---

## 9. Trasparenza

- **Timeline attività** (pannello laterale, si apre dal pulsante "Attività" del terminale): eventi in ordine cronologico con icona, ad esempio "Prompt inviato", "Bash: npm test", "Edit: src/auth.ts", "Letto panel AGENTS.md (v7)", "Scritto panel Backend v1 (v3 → v4)", "In attesa di permesso", "Risposta completata". Clic su un file → lo apre in un panel Codice.
- **Ispettore della freccia**: clic su una freccia → pannello laterale con direzione, accesso, cronologia di letture e scritture su quella connessione (orario, versione, dimensione in caratteri e stima dei token = caratteri/4) e anteprima dell'ultimo payload passato.
- **Anteprima del manifesto**: dal terminale Claude, voce di menu "Cosa vede Claude" che mostra il manifesto attuale esattamente come verrebbe iniettato.

---

## 10. Milestone

Ogni milestone termina con: app che si avvia, `npm run typecheck`, `npm run lint` e `npm test` verdi, un commit dedicato. Aggiorna la sezione 13 (Stato) a fine milestone.

### M0 — Scaffold
electron-vite + React + TS strict + Tailwind + ESLint + Prettier + vitest. Preload con un'API tipizzata di prova (`ping`). Impostazioni di sicurezza della sezione 3.
**Accettazione:** `npm run dev` apre una finestra; `window.plancia.ping()` risponde dal main.

### M1 — Canvas e workspace
Apri cartella; canvas React Flow con pan/zoom, minimap, griglia; toolbar per creare panel segnaposto; spostare, ridimensionare, eliminare; salvataggio in `.plancia/board.json` (debounce) e ripristino alla riapertura; ultima cartella aperta ricordata.
**Accettazione:** crea 3 panel, chiudi e riapri l'app → stesso layout.

### M2 — Panel Terminale
`PtyService` + xterm.js; modalità `shell` e `claude` (per ora `claude` senza config Plancia); resize; modalità focus; renderer WebGL limitato; anteprima a zoom basso; risoluzione del PATH; chiusura pulita dei PTY all'uscita dell'app.
**Accettazione:** in un terminale `shell` funzionano `vim`, `htop`, colori e Ctrl+C; in un terminale `claude` si dialoga normalmente con Claude Code.

### M3 — Server locale e hook
`LocalServer` con token; generazione di `settings.json` e `mcp.json` per terminale (MCP con un solo tool `list_panels` che restituisce lista vuota); verifica dei punti ⚠️ della sezione 7.1; stati del terminale dagli hook; timeline attività.
**Accettazione:** durante una richiesta a Claude il badge passa a `working`, mostra il tool corrente, torna a `idle` alla fine; una richiesta di permesso mette il badge in `needs-input`; la timeline elenca i tool usati.

### M4 — Panel Markdown
Crea/apri file, modifica e anteprima, salvataggio automatico, FileWatcher, versioni.
**Accettazione:** modificare `AGENTS.md` da un editor esterno aggiorna il panel; modificarlo nel panel aggiorna il file.

### M5 — Connessioni (il cuore)
Regole della sezione 6 (con test), resa grafica delle frecce, tool MCP completi per i markdown, manifesto con contenuto inline, protezione dei panel nel `PreToolUse`, annullamento, ispettore della freccia, "Cosa vede Claude".
**Accettazione (scenario completo):**
1. Crea `AGENTS.md` con una regola (es. "usa sempre pnpm"), collega Markdown → Claude. Chiedi a Claude "quali regole valgono in questo progetto?": risponde citando la regola **senza** che tu nomini il file.
2. Chiedi a Claude di aggiungere una regola ad `AGENTS.md`: rifiuta o riceve un errore di sola lettura, e lo spiega.
3. Aggiungi la freccia Claude → Markdown e ripeti: il file viene aggiornato, il panel lampeggia, la freccia diventa viola e si anima; "Annulla" ripristina la versione precedente.
4. Rimuovi entrambe le frecce: al messaggio successivo Claude non vede più il panel.

### M6 — Panel Architettura
Editor in modalità focus, anteprima SVG, `ArchitectureDoc` con zod, `read_panel`/`write_panel`/`get_panel_schema` per l'architettura, layout automatico dei nodi nuovi, evidenziazione delle modifiche di Claude, "Vedi JSON".
**Accettazione:** disegna 3 servizi e un database collegati; collegalo in lettura e chiedi a Claude di creare lo scaffold delle cartelle dei servizi → rispetta nomi e relazioni del diagramma. Collegalo in scrittura e chiedi "aggiungi una coda tra API e worker" → il diagramma si aggiorna con nodi posizionati in modo sensato; un JSON non valido viene rifiutato con un messaggio leggibile.

### M7 — Panel Codice
Feed dei file modificati dal `PostToolUse`, filtro per terminale, Monaco in sola lettura, diff rispetto a `HEAD`, aggiornamento in tempo reale, apertura manuale di un file.
**Accettazione:** chiedi a Claude di modificare due file → compaiono nel panel Codice in ordine, con diff corretto.

---

## 11. Struttura del progetto

```
plancia/
  electron.vite.config.ts
  electron-builder.yml
  resources/
    plancia-hook.js            # fallback se gli hook http non sono supportati
  src/
    shared/
      types.ts
      schemas.ts               # zod: board, panel, ArchitectureDoc
      access.ts                # regole delle connessioni (funzioni pure)
      ipc.ts                   # nomi dei canali e tipi dei payload
    main/
      index.ts
      workspace/WorkspaceService.ts
      board/BoardStore.ts
      access/AccessService.ts
      pty/PtyService.ts
      claude/ClaudeLauncher.ts
      claude/manifest.ts
      server/LocalServer.ts
      server/hooks.ts
      server/mcp.ts
      activity/ActivityLog.ts
      files/FileWatcher.ts
      files/resolveInWorkspace.ts
      git/GitService.ts
    preload/
      index.ts
    renderer/
      main.tsx
      App.tsx
      canvas/                  # React Flow, edge custom, toolbar
      panels/terminal/
      panels/markdown/
      panels/architecture/
      panels/code/
      inspectors/              # timeline, ispettore freccia, "Cosa vede Claude"
      stores/                  # zustand, specchio dello stato del main
  tests/
```

---

## 12. Convenzioni per chi implementa

- TypeScript strict, niente `any` (usa `unknown` + validazione zod ai confini: IPC, HTTP, file su disco).
- Ogni dato che entra dal mondo esterno (body degli hook, input dei tool MCP, `board.json`) passa da zod.
- Test obbligatori per: `access.ts`, `manifest.ts` (inclusi limiti di caratteri e iniezione solo su cambiamento), validazione `ArchitectureDoc`, handler dei tool MCP (accesso negato, conflitto di versione, path fuori workspace), protezione nel `PreToolUse`.
- Nessun segreto o token nei log; i token non compaiono mai in UI.
- Testi UI in italiano, codice e commenti in inglese.
- Se una scelta di questa specifica si rivela sbagliata o impossibile durante l'implementazione, **non aggirarla in silenzio**: annotala nella sezione 14 con il motivo e la soluzione adottata.

---

## 13. Stato

| Milestone | Stato | Note |
|---|---|---|
| M0 Scaffold | fatto | electron-vite 6, Electron 45, React 19, TS 6.0 strict, Tailwind 4, ESLint 10, vitest 5. `window.plancia.ping()` verificato. |
| M1 Canvas e workspace | fatto | React Flow 12 + zustand. Intenti validati con zod nel main (`BoardStore`), snapshot completo al renderer. Salvataggio con debounce 500 ms e flush su `before-quit`. Verificato: 3 panel, chiusura e riapertura con lo stesso layout. |
| M2 Terminale | fatto | node-pty 1.1 (N-API, nessun rebuild per Electron) + xterm 6 (fit, webgl, web-links). Verificati: colori 16/256/truecolor, vim, top (htop non installato), Ctrl+C, Claude Code con `--session-id`/`--name` e ripresa con `--resume`, modalità focus, anteprima sotto il 60%, nessun processo orfano dopo Cmd+Q. |
| M3 Server locale e hook | da fare | |
| M4 Markdown | da fare | |
| M5 Connessioni | da fare | |
| M6 Architettura | da fare | |
| M7 Codice | da fare | |

---

## 14. Decisioni e questioni aperte

- [ ] Gli hook passati con `--settings` si sommano a quelli dell'utente? (verificare in M3)
- [ ] Hook `type: "http"` supportati dalla versione installata? Altrimenti fallback `resources/plancia-hook.js`.
- [ ] Posizione esatta di `file_path` nell'input del `PostToolUse` per `Write`/`Edit`/`MultiEdit` (atteso: `tool_input.file_path`).
- [ ] Versione minima di Claude Code da richiedere (decidere dopo M3).
- [ ] Prima di distribuire: verificare termini d'uso e regole di branding di Anthropic per un'app che avvia la CLI dell'utente.
- [ ] Dopo l'MVP: multi-agente (frecce Terminale ↔ Terminale), valutando prima i canali nativi di Claude Code per la comunicazione tra sessioni; panel Design.
- [x] **Node 22.12+ richiesto** (`.nvmrc` = 22.14.0): vitest 5 non supporta Node 20. (M0)
- [x] **TypeScript fissato a ~6.0** invece di 7.x: typescript-eslint 8.72 supporta solo TS < 6.1. Da rivalutare quando typescript-eslint supporterà TS 7. In TS 6 `baseUrl` è deprecato: i `paths` sono relativi al tsconfig. (M0)
- [x] **Preload in CJS** (`out/preload/index.cjs`): con `sandbox: true` il preload non può essere un modulo ES. Main e renderer restano ESM. (M0)
- [x] Con npm 10.9 lo script di install di `electron` in un caso non ha scaricato il binario (`Error: Electron uninstall` su `npm run dev`). Rimedio: `node node_modules/electron/install.js`. Documentato nel README. (M0)
- [x] **Logo**: mascotte (testa di struzzo arancione, seconda versione) fornita dall'utente. `resources/icon.png` (icona app, 1024 px su quadrato arrotondato) e `src/renderer/assets/logo.png` (trasparente, 512 px). (M1)
- [x] **Stato transitorio nel renderer**: durante trascinamento e ridimensionamento React Flow aggiorna posizione e dimensione in locale per fluidità; a fine gesto il renderer invia l'intento (`movePanels`, `resizePanel`) e il main rimanda lo snapshot autorevole. Selezione e drag in corso restano solo UI. (M1)
- [x] **Viewport salvato** in `board.json` (`viewport`, opzionale): non era nella spec ma serve a ritrovare lo "stesso layout". L'intento `setViewport` salva ma non rimanda lo snapshot. (M1)
- [x] **Panel Markdown segnaposto**: in M1 punta a `AGENTS.md` senza creare il file; in M4 "Nuovo file markdown" / "Apri markdown" sostituiscono questo default. (M1)
- [x] **board.json corrotto o di versione più recente**: la cartella non viene aperta (nessuna sovrascrittura) e l'errore è mostrato all'utente; resta aperto il workspace precedente. (M1)
- [x] **UI allineata al design Claude Design** ("Lavagna dinamica per Claude"): tema scuro caldo (`#111110`, accento `#D97757`), Geist e Geist Mono, icone Phosphor, top bar (marchio / progetto, numero agenti), barra strumenti verticale a sinistra con tooltip e scorciatoie (V, H, T, L, M, A, K; Esc, 0 = adatta), zoom in basso a destra, rotella = pan e pinch/Ctrl+rotella = zoom. Token in `src/renderer/index.css`. Font e icone sono pacchetti npm (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, `@phosphor-icons/react`) e non CDN, per funzionare offline e con la CSP. Non portati ora: porte e frecce (M5), panel Design, penna/gomma, "Condividi" (fuori MVP), aggancio della barra su altri lati. La minimappa resta (richiesta in M1). (M1)
- [x] **PATH e ambiente dei terminali** (M2): invece di `$SHELL -l -c "<comando>"` per ogni avvio, all'avvio l'app legge una volta l'ambiente completo della shell di login e interattiva (`$SHELL -i -l -c`, stampato come JSON dallo stesso binario Electron in modalità Node, come fa VS Code). Poi `claude` viene cercato in quel PATH e avviato direttamente: niente quoting del titolo del panel in una riga di shell. Le shell partono come `$SHELL -l`. Se `claude` non si trova, il panel mostra l'errore con il link a https://code.claude.com/docs/en/setup.
- [x] **Variabili di una sessione Claude Code ospite** (M2): se Plancia viene avviata da dentro Claude Code (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`…), queste variabili facevano partire `claude` come sessione figlia, senza transcript e quindi senza `--resume`. Vengono rimosse prima di interrogare la shell di login, così quelle impostate davvero nei dotfile restano.
- [x] **`--session-id` già in M2** (anticipato da M3): ogni terminale Claude ha un UUID salvato in `board.json` (`claudeSessionId`). Alla riapertura il panel offre "Riprendi sessione" (`--resume`) o "Nuova sessione". `--mcp-config`, `--settings` e `--append-system-prompt-file` arrivano in M3.
- [x] **Avvio dei terminali**: un terminale creato dall'utente parte subito; dopo la riapertura della lavagna parte solo con un clic (spec §4). La cronologia dell'output resta in memoria nel main (ultimi 512 K caratteri) e sopravvive a "Riavvia". Il renderer la recupera con offset assoluti, senza duplicati, quando l'istanza xterm viene ricreata.
- [x] **Stati dei badge** (M2, colori dal design invece di quelli della spec): `in attesa` grigio, `al lavoro` arancione pulsante, `richiede input` arancione pieno, `terminato` rosato, `non avviato` grigio. Per le shell `idle` si legge "attivo". `working` e `needs-input` arriveranno dagli hook in M3.
- [x] **Esc in modalità focus**: Esc chiude la modalità focus solo se il focus non è dentro un terminale, perché vim e Claude usano Esc. Per uscire ci sono anche il pulsante "Esci" e il doppio clic sull'header.
- [x] **Conferma di eliminazione**: chiesta per *ogni* terminale con un processo in esecuzione, non solo quando Claude lavora, perché Backspace su un panel selezionato lo elimina.
- [x] **Limite noto**: con lo zoom della lavagna diverso dal 100%, la selezione col mouse in xterm può non coincidere col testo (xterm non conosce la scala CSS). Per lavorare di precisione c'è la modalità focus al 100%.
- [x] **Font del terminale**: Geist Mono, con fallback ai Nerd Font installati (MesloLGS NF, Symbols Nerd Font…) per le icone dei prompt.
