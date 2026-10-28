<div align="center">

**English** · [Italiano](docs/readme/README_it.md)

<img src="docs/assets/logo.png" alt="OpenPlancia logo" width="112" />

# OpenPlancia

An infinite whiteboard for working with Claude Code.<br />
Terminals, files and diagrams share one canvas, and the arrows between them decide what Claude can read and write.

[![Release](https://img.shields.io/github/v/release/Marco-Pagnanini/OpenPlancia?include_prereleases&style=flat-square&label=release)](https://github.com/Marco-Pagnanini/OpenPlancia/releases)
[![Platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-555?style=flat-square)](#download)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-D97757?style=flat-square)](https://code.claude.com)

[Download](#download) · [Features](#features) · [Technical details](#technical-details) · [What's next](#whats-next) · [Build from source](#build-from-source)

</div>

<br />

<div align="center">

<a href="docs/assets/openplancia-demo.mp4"><img src="docs/assets/openplancia-demo.gif" alt="OpenPlancia demo: two Claude sessions connected by an arrow exchange messages, then Claude edits an architecture diagram" width="100%" /></a>

<sub>The demo at 8x speed. <a href="docs/assets/openplancia-demo.mp4">Watch the full 3-minute video</a>.</sub>

</div>

## Download

| System                | File                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | [OpenPlancia-0.1.1-mac-arm64.dmg](https://github.com/Marco-Pagnanini/OpenPlancia/releases/download/v0.1.1/OpenPlancia-0.1.1-mac-arm64.dmg)                                                                                                      |
| macOS (Intel)         | [OpenPlancia-0.1.1-mac-x64.dmg](https://github.com/Marco-Pagnanini/OpenPlancia/releases/download/v0.1.1/OpenPlancia-0.1.1-mac-x64.dmg)                                                                                                          |
| Windows               | [OpenPlancia-0.1.1-win-x64.exe](https://github.com/Marco-Pagnanini/OpenPlancia/releases/download/v0.1.1/OpenPlancia-0.1.1-win-x64.exe)                                                                                                          |
| Linux                 | [AppImage](https://github.com/Marco-Pagnanini/OpenPlancia/releases/download/v0.1.1/OpenPlancia-0.1.1-linux-x86_64.AppImage) · [.deb](https://github.com/Marco-Pagnanini/OpenPlancia/releases/download/v0.1.1/OpenPlancia-0.1.1-linux-amd64.deb) |

All versions are on the [Releases page](https://github.com/Marco-Pagnanini/OpenPlancia/releases). OpenPlancia runs your own Claude Code CLI, so [Claude Code](https://code.claude.com) must be installed and logged in.

The builds are not signed with a paid certificate, so the first launch needs one extra confirmation:

- **macOS:** open the app, close the warning, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Windows:** in the SmartScreen dialog, click **More info → Run anyway**.
- **Linux:** `chmod +x` the AppImage, or install the package with `sudo apt install ./OpenPlancia-*.deb`.

## Features

<img src="docs/assets/board.png" alt="An OpenPlancia board: an architecture diagram connected to a Claude Code session with a two-way arrow" width="100%" />

Every terminal, Markdown file and diagram is a panel on the board. To give Claude a file you draw an arrow; to take it away you delete the arrow.

| Arrow                   | What Claude can do                                                  |
| ----------------------- | ------------------------------------------------------------------- |
| panel → Claude          | read the panel, which is added to its context                       |
| Claude → panel          | write the file, with `Write`/`Edit` or the `write_panel` tool       |
| both directions         | read and write                                                      |
| no arrow                | nothing: writes to the panel's file are blocked before they run     |
| Claude → another Claude | send it messages with `SendMessage`; arrows both ways let them talk |

Panels:

- **Terminal and Claude Code sessions.** Real shells (node-pty and xterm.js). Claude sessions resume after a restart with `--resume`, one at a time or all together.
- **Markdown.** Preview and edit with Monaco. External changes are picked up, and if the file changes while you type you choose which version to keep.
- **Folder.** One panel for a whole folder of `.md` files. A single arrow gives Claude the folder, and a write arrow lets it create new files there.
- **Architecture.** A node editor for services, APIs, databases and queues. Claude reads it as validated JSON and can edit it; new nodes are laid out next to the ones they connect to, and invalid edits are rejected with the exact error.
- **Code.** The files the agents are changing, newest first, with a read-only diff against the last commit, updated live.

Around the panels:

- Each Claude session shows whether it is working, waiting for input or idle, plus the tool it is using. An activity log keeps the history.
- An arrow animates when Claude uses it. The inspector lists every read and write, and "What Claude sees" shows the exact text sent to the session.
- Every write Claude makes to a panel can be undone, up to 20 steps per file.

## Technical details

| Layer       | Stack                                                        |
| ----------- | ------------------------------------------------------------ |
| Desktop app | Electron 45, electron-vite, electron-builder                 |
| Interface   | React 19, React Flow 12, zustand, Tailwind CSS 4             |
| Terminals   | node-pty, xterm.js 6 (WebGL on the active panel)             |
| Editor      | Monaco, loaded on demand                                     |
| Contracts   | TypeScript strict, zod at every boundary (IPC, files, hooks) |
| Claude Code | hooks, a local MCP server, `--session-id` / `--resume`       |

**How Claude gets the context.** OpenPlancia starts each Claude session with its own hooks and a local MCP server called `plancia`. The hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`) talk to a server on `127.0.0.1` with a random port and a 32-byte token. `UserPromptSubmit` sends the list of connected panels, `PreToolUse` blocks writes that have no arrow, and the MCP server exposes `list_panels`, `read_panel`, `write_panel` and `get_panel_schema`.

**Context stays small.** Only connected panels are sent, and only when they change: at session start, then again when a panel's version or the arrows change. A folder is sent as an index of its files plus the small ones; Claude reads the rest with `read_panel` when it needs them. An architecture diagram is sent as compact JSON without positions, about 220 tokens for 6 nodes and 6 relations, against roughly 1,700 for a screenshot of the same diagram.

**Storage.** Each project keeps its board in `.plancia/board.json` inside the project folder, so it can be committed with the code or ignored.

**Security.** The renderer runs with `contextIsolation` and `sandbox` and a strict CSP, and the preload exposes only a typed API. Every path is resolved and checked against the project folder before a read or write. Claude never writes inside `.plancia/` directly: diagrams go through `write_panel`, which validates them.

The full architecture, with diagrams and a map of every file, is in [ARCHITECTURE.md](ARCHITECTURE.md) (in Italian).

## What's next

**Reusable templates.** Save a board as a template, with its panels, arrows and Claude sessions, and start a new project from it. For example, a planner, an implementer and a reviewer already connected to a shared `PLAN.md`, ready to use in any repository.

Also planned:

- Signed and notarized macOS builds, so the first launch needs no extra steps.
- Manual testing on Windows and Linux. The packages are built by CI, but so far the app has only been tested by hand on macOS.

## Build from source

You need [Node.js](https://nodejs.org/) 22.12 or later and [Claude Code](https://code.claude.com) installed and logged in.

```bash
git clone https://github.com/Marco-Pagnanini/OpenPlancia.git
```

```bash
cd OpenPlancia && nvm use && npm install
```

```bash
npm run dev
```

Open a project folder, press <kbd>L</kbd> for a Claude session and <kbd>M</kbd> for a Markdown file, then drag an arrow from one panel's handle to the other.

<details>
<summary><b>Keyboard shortcuts</b></summary>

<br />

| Key                                   | Action                               |
| ------------------------------------- | ------------------------------------ |
| <kbd>V</kbd>                          | pointer                              |
| <kbd>H</kbd>                          | pan the board                        |
| <kbd>T</kbd>                          | new terminal                         |
| <kbd>L</kbd>                          | new Claude session                   |
| <kbd>M</kbd>                          | new Markdown file, or open one       |
| <kbd>F</kbd>                          | new folder panel                     |
| <kbd>A</kbd>                          | new architecture diagram             |
| <kbd>K</kbd>                          | new Code panel                       |
| <kbd>0</kbd>                          | fit all panels in view               |
| <kbd>Backspace</kbd> / <kbd>Del</kbd> | delete the selected panels or arrows |
| <kbd>Esc</kbd>                        | back to the pointer                  |
| double-click a panel header           | focus mode                           |

</details>

<details>
<summary><b>Scripts</b></summary>

<br />

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | start the app in development (HMR on the renderer) |
| `npm run build`      | typecheck and build into `out/`                    |
| `npm run typecheck`  | `tsc` on main, preload, shared and renderer        |
| `npm run lint`       | ESLint                                             |
| `npm test`           | vitest                                             |
| `npm run dist:mac`   | `.dmg` for Apple Silicon and Intel                 |
| `npm run dist:win`   | `.exe` installer (NSIS), from Windows              |
| `npm run dist:linux` | AppImage and `.deb`, from Linux                    |

Each platform must be built on that platform, because `node-pty` is a native module. Pushing a `v*` tag runs [release.yml](.github/workflows/release.yml), which builds all three and attaches them to a draft release.

To try the app without touching your own settings: `PLANCIA_USER_DATA=/some/path npm run dev`.

</details>

## Known limitations

- File changes Claude makes through `Bash` can't be intercepted reliably. Blocking and the Code panel cover `Write`, `Edit`, `MultiEdit` and `NotebookEdit`.
- When the board zoom isn't 100%, mouse selection in terminals can drift from the text. Use focus mode.
- If `npm run dev` fails with `Error: Electron uninstall`, run `node node_modules/electron/install.js`.

---

<div align="center">
<sub>
OpenPlancia is an independent project and is not affiliated with Anthropic.<br />
Claude and Claude Code are trademarks of Anthropic.
</sub>
</div>
