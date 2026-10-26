# Plancia

Lavagna infinita per sviluppatori: panel (terminali Claude Code, markdown, architetture, codice) collegati da frecce che definiscono il contesto dell'agente. Specifica completa in [docs/MVP_SPEC.md](docs/MVP_SPEC.md).

> "Plancia" è un nome provvisorio. Non è un prodotto Anthropic.

## Requisiti

- Node.js **22.12+** (`nvm use` legge `.nvmrc`)
- npm
- [Claude Code](https://code.claude.com) installato, per i terminali in modalità `claude` (dalla M2)

## Script

| Comando             | Cosa fa                                                    |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Avvia l'app in sviluppo (HMR sul renderer)                 |
| `npm run build`     | Typecheck + build in `out/`                                |
| `npm run typecheck` | `tsc` su main/preload/shared e renderer                    |
| `npm run lint`      | ESLint                                                     |
| `npm test`          | vitest                                                     |
| `npm run dist`      | Pacchetto con electron-builder in `release/` (non firmato) |

## Sicurezza

- Renderer con `contextIsolation`, `sandbox`, senza `nodeIntegration`; CSP restrittiva.
- Il preload espone solo `window.plancia.*` tipizzato (`src/shared/ipc.ts`), mai `ipcRenderer` grezzo.
- Navigazione e nuove finestre bloccate; i link http(s) si aprono nel browser di sistema.

## Limiti noti

- Le modifiche ai file fatte da Claude tramite `Bash` non sono intercettabili in modo affidabile (vedi spec §7.5).
- Con lo zoom della lavagna diverso dal 100% la selezione col mouse nei terminali può non coincidere col testo: usa la modalità focus (doppio clic sull'header).

## Sviluppo

- `PLANCIA_USER_DATA=/percorso npm run dev` usa una cartella dati separata (impostazioni, ultima cartella aperta), per provare senza toccare la propria. È ignorata nell'app pacchettizzata.

## Problemi noti

- Se `npm run dev` fallisce con `Error: Electron uninstall`, il binario di Electron non è stato scaricato durante l'install: esegui `node node_modules/electron/install.js`.
