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
- Frecce **Terminale ↔ Terminale** (multi-agente). Nell'MVP la connessione veniva rifiutata con un messaggio "in arrivo"; implementate dopo l'MVP in M8 (vedi §13 e §14).
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
| Validazione | `zod` (`z.toJSONSchema` per esporre lo schema a Claude) |
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
| Terminale Claude → Terminale Claude | ✅ (M8) | Il primo può scrivere al secondo con SendMessage (messaggi nativi di Claude Code) |
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
| `get_panel_schema` | `{ type: "architecture" }` | JSON Schema dell'`ArchitectureDoc` (da `z.toJSONSchema` di zod 4). |

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

### 8.5 Cartella (aggiunta dopo M6, "M6.5")
- Una cartella del progetto scelta con un dialog (tasto `F`), mostrata come albero dei suoi file `.md`/`.mdx` (fino a 4 sottocartelle, max 500 file, senza cartelle nascoste, `node_modules`, `.git`, `.plancia`, symlink).
- Sulla lavagna albero + anteprima del file selezionato; in modalità focus albero + editor (come un panel Markdown). "Apri come panel" crea un panel Markdown del singolo file.
- Freccia Cartella → Claude: indice nel contesto + file piccoli; gli altri con `read_panel(panelId, path)`. Freccia Claude → Cartella: modifica e crea `.md` (`write_panel` con `path`, `baseVersion` 0 per i nuovi), non cancella. Senza freccia di scrittura i `.md` della cartella sono protetti nel `PreToolUse`.
- Eliminare il panel non cancella file.

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

### M6.5 — Panel Cartella
Albero dei `.md` di una cartella, anteprima ed editor, estrazione in panel Markdown, accesso di Claude per cartella (indice nel contesto, `path` nei tool MCP, creazione di file).
**Accettazione:** collega `docs/` in lettura e chiedi quale package manager usare e cosa resta nel piano → Claude risponde dai file senza che li nomini. Aggiungi la freccia in scrittura e chiedi un nuovo ADR e una voce spuntata nel piano → il file nuovo compare nell'albero, il piano si aggiorna, entrambi segnati come modificati da Claude.

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
| M3 Server locale e hook | fatto | Server su 127.0.0.1 (porta casuale, token di 32 byte nel path, controllo di Host e Origin). Hook http + bridge `command` per SessionStart, MCP `plancia` stateless con `list_panels`. Verificati con Claude Code 2.1.310: badge `al lavoro` con il tool corrente → `in attesa`, `richiede input` sul permesso di Write, timeline in Attività, `list_panels` chiamato senza prompt. |
| M4 Markdown | fatto | Monaco 0.57 (locale, lazy) + react-markdown/GFM, chokidar 5, versioni per panel, autosalvataggio 500 ms, conflitti. Verificati: modifica esterna di `AGENTS.md` → il panel si aggiorna; modifica nel panel → il file si aggiorna; conflitto con bozza non salvata. |
| M5 Connessioni | fatto | Scenario di accettazione superato con Claude Code 2.1.310: (1) Markdown → Claude: alla domanda sulle regole Claude cita pnpm senza che il file venga nominato; (2) richiesta di scrittura in sola lettura: `write_panel` rifiutato, Claude lo spiega, file intatto; (3) con la freccia Claude → Markdown il file si aggiorna, il panel lampeggia, il filo diventa viola e si anima, "Annulla" ripristina; (4) tolte le frecce, al messaggio dopo Claude dice di non avere più panel collegati. |
| M6 Architettura | fatto | `ArchitectureDoc` con zod (controlli incrociati, errori leggibili), dagre 3.1 per i nodi nuovi, anteprima SVG, editor React Flow in modalità focus, "Vedi JSON", `get_panel_schema`. Scenario di accettazione superato con Claude Code 2.1.310: disegnati client, API, 3 servizi e Postgres e collegato in lettura, Claude ha creato una cartella per ogni servizio con gli id e le relazioni del diagramma; con la freccia in scrittura, "aggiungi una coda tra API e worker" ha aggiunto il nodo `coda` e le due relazioni senza spostare i nodi esistenti (panel lampeggiante, "Annulla" funzionante); una relazione verso un nodo inesistente è stata rifiutata con `to: il nodo "fantasma" non esiste → at edges[8].to`, versione invariata. |
| M6.5 Cartella | fatto | `FolderService` (indice, chokidar sulla cartella, versioni per file) sopra `MarkdownService` esteso per file (eco, Annulla e attribuzione condivisi con i panel Markdown). Accettazione superata con Claude Code 2.1.310: con `docs/` in lettura Claude ha risposto "pnpm" e le due voci aperte del piano senza usare strumenti; con la freccia in scrittura ha creato `adr/0002-coda.md` e spuntato la voce nel piano (versione 2), con il pallino "modificato da Claude" su entrambi i file. |
| M7 Codice | fatto | Feed dal `PostToolUse` (Write/Edit/MultiEdit/NotebookEdit riusciti), filtro per terminale, Monaco in sola lettura con diff rispetto a `HEAD` (`git show`, solo lettura), aggiornamento in tempo reale, "Apri file…". Accettazione superata con Claude Code 2.1.310: chiesto di modificare `api-gateway/orders.go` e poi `worker/main.go`, il panel li ha elencati nell'ordine giusto (il più recente in alto) con il diff corretto rispetto al commit; una modifica fatta da fuori al file aperto è comparsa subito. |
| M8 Multi-agente | fatto | Messaggi nativi tra sessioni di Claude Code (`SendMessage`, v2.1.224+) governati dalle frecce Terminale → Terminale. Accettazione superata con Claude Code 2.1.310: senza freccia "Claude" → "Claude 2" il messaggio è stato negato con la spiegazione; aggiunta la freccia, "Claude 2" ha ricevuto la richiesta e creato `agenti.txt`; senza freccia di ritorno la sua risposta è stata bloccata; con le due frecce ha risposto via `SendMessage` e l'ispettore mostra i due messaggi (filo "si scrivono"). |

---

## 14. Decisioni e questioni aperte

- [x] Gli hook passati con `--settings` si sommano a quelli dell'utente: **sì**. Verificato (M3) con `claude -p --include-hook-events`: su SessionStart sono partiti 7 hook (utente + plugin + Plancia), su Stop 10.
- [x] Hook `type: "http"`: supportati (verificato su 2.1.296 e 2.1.310) per tutti gli eventi usati **tranne SessionStart**, che accetta solo `command`/`mcp_tool` (documentazione hooks). Per SessionStart si usa il bridge `resources/plancia-hook.cjs` (`.cjs` e non `.js`: il `package.json` del progetto è `"type": "module"`), eseguito con il binario di Plancia in modalità Node (`ELECTRON_RUN_AS_NODE=1`). Il bridge esce sempre con 0. Su Windows il comando non è verificato.
- [x] `file_path` è in `tool_input.file_path` per Write/Edit/MultiEdit, `notebook_path` per NotebookEdit (documentazione e payload reali). Altri campi verificati: `notification_type` (`permission_prompt`, `idle_prompt`, …), `last_assistant_message` in Stop, `reason` in SessionEnd, `tool_use_id` in Pre/PostToolUse.
- [x] Versione minima di Claude Code: 2.1.296 (vedi nota M3 sotto).
- [ ] Prima di distribuire: verificare termini d'uso e regole di branding di Anthropic per un'app che avvia la CLI dell'utente.
- [x] Dopo l'MVP: multi-agente (frecce Terminale ↔ Terminale): fatto in M8 sui messaggi nativi di Claude Code. Resta il panel Design.
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
- [x] **Eventi hook in più rispetto alla spec** (M3): `PostToolUseFailure` (tool fallito), `PermissionDenied` (negato dalla modalità auto) e `StopFailure` (errore API, così lo stato torna `in attesa`). A fine turno i tool rimasti "in corso" senza `PostToolUse` diventano "annullati": succede quando un hook di un altro plugin (es. un gate) blocca la chiamata.
- [x] **SessionEnd** imposta `terminato` solo se la sessione finisce davvero: con `reason` `clear` o `resume` il processo continua con un'altra sessione. Su SessionStart con un `session_id` diverso (dopo `/clear` o `/resume` interno) l'id salvato si aggiorna, così "Riprendi sessione" riprende quella giusta.
- [x] **needs-input** solo per `notification_type` `permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog`, `agent_needs_input`; `idle_prompt` è informativo. Notifica di sistema solo se la finestra non ha il focus.
- [x] **ActivityLog su disco**: `userData/activity/<hash del percorso del workspace>/<terminalId>.jsonl`, ultimi 500 eventi per terminale, scritture serializzate (un aggiornamento non arriva mai prima dell'evento che aggiorna). Il file viene cancellato con il panel.
- [x] **File di runtime**: `userData/run/<terminalId>/{mcp,settings}.json` (0600, cartella 0700) e `run/plancia-system.md`. Token nuovo a ogni avvio di Claude; la cartella `run` viene svuotata all'avvio dell'app.
- [x] **Server MCP stateless**: un `McpServer` + trasporto Streamable HTTP per richiesta (`enableJsonResponse`), GET/DELETE → 405. Il server locale rifiuta Host diversi da `127.0.0.1:<porta>`/`localhost:<porta>` e qualsiasi richiesta con header `Origin` (protezione da DNS rebinding e da pagine web).
- [x] **Versione minima di Claude Code**: gli hook http e i campi usati funzionano dalla 2.1.296; `onFailure` richiede 2.1.295. Proposta: minimo 2.1.296.
- [x] **chokidar 5 invece di 6** (M4): chokidar 6 richiede Node ≥ 22.22, i test girano su Node 22.14. La 5 ha la stessa API e richiede Node ≥ 20.19.
- [x] **DOMPurify forzato a 3.4.17** (`overrides` nel `package.json`, M4): monaco-editor 0.57 dipende da DOMPurify 3.4.15, interessata da avvisi di sicurezza critici. La 3.4.17 non è vulnerabile; `npm audit` è pulito.
- [x] **Monaco e tastiera** (M4): su Chromium Monaco scrive tramite `EditContext` (un `div`, non una `textarea`). Senza correzioni, scrivendo nell'editor `t` creava un terminale, `m` apriva il menu e Backspace eliminava il panel. Ora le scorciatoie ignorano `.monaco-editor`, `.xterm`, `.nokey` ed elementi con `editContext`, e il corpo dei panel ha la classe `nokey` (React Flow ignora i suoi tasti lì dentro).
- [x] **Creazione dei panel Markdown** (M4): il dialog nativo "Nuovo / Apri" è mostrato dal main, che accetta solo file dentro il progetto e non sovrascrive mai un file esistente ("Nuovo" su un file già esistente lo apre). L'intento `createPanel` di tipo markdown richiede `filePath`. Il dialog nativo non è coperto dai test automatici: va provato a mano.
- [x] **Versione dei panel Markdown** (M4): +1 a ogni salvataggio dal panel e a ogni modifica esterna rilevata; le scritture portano la `baseVersion` e vengono rifiutate se il file è cambiato nel frattempo (avviso di conflitto nel panel). La cronologia per "Annulla" arriva con la M5 (spec §7.5).
- [x] **Dimensione del bundle** (M4): Monaco aggiunge circa 20 MB di asset, compresi i worker dei linguaggi caricati solo quando servono. Accettabile per un'app desktop, ed è riusato dal panel Codice in M7.
- [x] **Manifesto quando l'ultima freccia viene tolta** (M5): la spec dice di iniettare solo se le connessioni cambiano; togliendo l'ultima, Plancia inietta una riga di fatto ("nessun panel è collegato a questa sessione; i contenuti ricevuti in precedenza non sono più accessibili"), perché Claude ha ancora il vecchio contenuto nella conversazione.
- [x] **Protezione anche dei panel non collegati** (M5): come da spec §7.5, un file mostrato in un panel Markdown si modifica con Write/Edit solo con una freccia di scrittura da quel terminale; senza alcuna freccia la scrittura viene negata con un messaggio che lo spiega. Gli altri file del progetto non sono toccati da Plancia.
- [x] **Annulla per file, non per panel** (M5): la pila (ultime 20) è legata al file, così più panel sullo stesso file condividono la stessa cronologia. Le modifiche fatte con Edit/Write vengono attribuite a Claude se arrivano entro 30 s da un `PreToolUse` consentito sullo stesso file.
- [x] **Fili** (M5): colori blu `#8fa9c9`, ambra `#e0b97e`, viola `#b294d6` (tonalità della palette del design). Canvas in `ConnectionMode.Loose`: si trascina da una porta all'altra e il verso del trascinamento è il verso della freccia. Le porte stanno sopra i controlli di ridimensionamento: prima, su un panel selezionato, il rilascio cadeva sulla linea di ridimensionamento e la freccia non si creava.
- [x] **Badge connessioni** (M5): icone ↓ (lettura) / ↑ (scrittura) al posto delle emoji 📥 📤 della spec, per coerenza con le icone Phosphor.
- [x] **Verifica automatica e finestra nascosta**: quando la finestra di Electron è coperta, Chromium non disegna (`visibilityState: hidden`), React Flow non misura le porte (niente fili) e gli eventi di input via DevTools restano in attesa. Non è un difetto dell'app, ma i test automatici dell'interfaccia vanno fatti a finestra visibile. Da controllare a mano: il toast "Claude vedrà questo collegamento al prossimo messaggio" dopo un trascinamento riuscito (non osservato nell'unica prova a finestra visibile; il codice e il toast di rifiuto funzionano).
- [x] **Nome: OpenPlancia** (dopo M5): l'app, il pacchetto (`openplancia`), il titolo e i testi si chiamano OpenPlancia. Restano invariati gli identificatori interni: la cartella `.plancia/` nei progetti (le lavagne esistenti continuano ad aprirsi), il server MCP `plancia` (tool `mcp__plancia__*`), i canali IPC `plancia:*`. Al primo avvio le impostazioni del vecchio profilo `plancia` vengono copiate nel nuovo.
- [x] **Schermata iniziale** (dopo M5): clic sul logo = chiude la lavagna (con conferma se ci sono terminali in esecuzione, che vengono chiusi) e torna alla schermata iniziale, che elenca le cartelle recenti (ultime 8). Tornare alla home fa dimenticare l'"ultima cartella": al riavvio si parte dalla home.
- [x] **JSON Schema senza `zod-to-json-schema`** (M6): zod 4 ha `z.toJSONSchema`; `get_panel_schema` lo usa (con `io: "input"`) e aggiunge in testo le regole che lo schema non esprime (id unici, relazioni verso nodi esistenti).
- [x] **Formato del documento per Claude** (M6): JSON valido senza posizioni, un nodo o una relazione per riga (`formatArchitectureForClaude`). Sul diagramma della demo: 874 caratteri contro 1.729 del file su disco (indentato, con posizioni). "Vedi JSON" mostra esattamente questo testo.
- [x] **Scritture di Claude sulle architetture** (M6): si riscrive sempre il documento completo; `content` può essere un oggetto o una stringa JSON; `mode: "append"` è rifiutato. Le posizioni mandate da Claude per nodi già esistenti vengono ignorate (restano quelle dell'utente); i nodi nuovi senza posizione sono piazzati con dagre (sinistra → destra) rispetto ai vicini e spostati in basso finché non si sovrappongono.
- [x] **Vita del file `.arch.json`** (M6): creato vuoto con il panel (sovrascrivendo eventuali avanzi con lo stesso id), copiato con "Duplica", cancellato con il panel. Per questo eliminare un'architettura non vuota chiede conferma. Le modifiche fatte a mano al file con l'app aperta non vengono osservate (il file è dati dell'app, non del progetto).
- [x] **Id dei nodi** (M6): un nodo aggiunto dall'editor prende un id provvisorio dal tipo (`servizio-2`); quando lo si nomina, l'id diventa lo slug del nome, ma solo finché nessuna relazione lo usa. Dopo resta stabile, perché è il riferimento che Claude usa tra una versione e l'altra.
- [x] **Collegare nodi nell'editor** (M6): oltre al rilascio su un pallino (raggio di React Flow), vale il rilascio sul corpo del nodo (`onConnectEnd` + `elementFromPoint`). Il canvas dell'editor sta dentro `.nokey`, quindi Canc/Backspace sono gestiti dall'editor stesso.
- [x] **Panel Cartella** (M6.5, aggiunto alla spec su richiesta): scelte dell'utente — solo `.md` con sottocartelle; nel contesto indice + file piccoli; Claude modifica e crea ma non cancella; albero con anteprima ed estrazione. Dettagli: un file mostrato da una cartella e da un panel Markdown è uno solo (stessa versione, stesso Annulla); le frecce si sommano (basta una freccia di scrittura verso uno dei panel che lo mostrano, prima serviva su tutti); un file in due cartelle collegate entra nel contesto una volta sola; le versioni dei file delle cartelle vivono in memoria (il panel ha comunque la sua versione salvata, che sale a ogni cambio). "Nuovo file" dall'interfaccia non c'è ancora (`window.prompt` non esiste in Electron): i file nuovi li crea Claude o l'editor esterno.
- [x] **Panel Codice** (M7): il feed vive in memoria e si azzera chiudendo la cartella o riavviando (la spec non chiede di salvarlo). Un file per riga con l'ultimo terminale, l'ora e il numero di modifiche. Senza una scelta a mano il panel mostra l'ultimo file modificato ("Segui l'ultimo" torna a questo comportamento). git è usato solo in lettura e con timeout; senza git, o per un file nuovo, si vede solo il contenuto. File binari e oltre 2 MB non vengono mostrati. Monaco colora i linguaggi senza i loro worker: hover, diagnostica e completamento sono spenti, che per un visualizzatore in sola lettura va bene.
- [x] **Smontaggio del DiffEditor** (M7): `@monaco-editor/react` 4.7 distrugge i modelli prima che il widget li rilasci ("TextModel got disposed before DiffEditorWidget model got reset"). Il visualizzatore tiene i modelli (`keepCurrent…Model`), li stacca con `setModel(null)` nella propria pulizia, che React esegue prima di quella della libreria, e li distrugge subito dopo.
- [x] **Riprendi tutti gli agenti** (dopo M7, su richiesta): alla riapertura ogni terminale Claude aspetta il suo "Riprendi sessione"; un pulsante nella barra in alto li avvia tutti insieme (riprende chi ha una sessione, avvia gli altri). Non parte da solo: avviare agenti consuma e l'utente può non volerli tutti.
- [x] **Sessione senza conversazione** (dopo M7): una sessione avviata ma mai usata non ha transcript e `--resume` fallisce ("No conversation found"). Prima di riprendere si cerca `<sessionId>.jsonl` sotto `~/.claude/projects/*/` (o `CLAUDE_CONFIG_DIR`); se manca si avvia la stessa sessione da zero (`--session-id`). Se la cartella non esiste si prova comunque `--resume`.
- [x] **Multi-agente (M8), scelte dell'utente**: freccia A → B = A può scrivere a B; senza freccia il messaggio è bloccato; sessioni fuori dalla lavagna bloccate; consegna nativa (il destinatario agisce da solo, con i suoi permessi).
- [x] **Come**: niente protocollo nuovo. Claude Code ha già i messaggi tra sessioni (`ListAgents`/`SendMessage`, socket locale per sessione, attivi di default). OpenPlancia li regola nel `PreToolUse` e li registra nel `PostToolUse`. I channels sono stati scartati (anteprima, solo stdio, flag `--dangerously-…` con conferma), e così gli agent teams (i compagni nascono dentro una sessione, non sono i nostri panel).
- [x] **Input reale di SendMessage** (letto con un hook di prova che negava la chiamata): `to`, `recipient`, `recipient_kind` ("name"), `message`/`content`, `summary`, `notify_when_idle`. Un messaggio a un proprio subagent ha la stessa forma: per questo OpenPlancia registra i subagent quando Claude li avvia (tool `Agent`: `name`, `agentId`) e li lascia passare.
- [x] **Risposte**: una risposta è indirizzata al socket del mittente (`uds:/tmp/cc-socks/<pid>.sock`). Lo script ponte di SessionStart inoltra `CLAUDE_CODE_MESSAGING_SOCKET`, così OpenPlancia sa a quale terminale appartiene. Claude Code mostra i nomi con i trattini (`@Claude-2`): spazi, trattini e trattini bassi sono equivalenti.
- [x] **Nome dell'agente**: è quello con cui la sessione è nata (`--name`), salvato come `claudeName`; rinominare il panel dopo non cambia come gli altri lo chiamano.
- [ ] Possibili miglioramenti dopo l'MVP: pulsante "Riordina" (dagre su tutto il diagramma), unione tra modifiche locali non ancora salvate e scrittura di Claude (oggi vince Claude e compare un avviso).
