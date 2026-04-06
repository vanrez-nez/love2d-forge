# Love2D Hot Reload — Current Architecture

## Overview

This extension launches Love2D projects through a generated bootstrap directory, watches
Lua files in the workspace, and logs the full reload path in the VS Code `Love2D`
output channel.

## Runtime Flow

1. `love2d.launch` resolves the Love executable and prepares a temp bootstrap folder.
2. The bootstrap folder contains generated `conf.lua`, generated `main.lua`, and
   injected `__hot__.lua`.
3. The generated bootstrap loads the user project, extends `package.path`, and enables
   Lua-side module polling.
4. The extension watches `**/*.lua`, debounces save events, classifies the changed path,
   and currently restarts the Love process when it is already running.

## Commands

| Command | Description |
|---|---|
| `love2d.launch` | Launch the game |
| `love2d.stop` | Stop the running process |
| `love2d.reload` | Restart the game manually |

## Configuration

| Setting | Description | Default |
|---|---|---|
| `love2d.executablePath` | Path to `love`. Empty means auto-detect or PATH fallback. | `""` |
| `love2d.reloadDebounce` | Milliseconds to wait after a watched save before acting. | `300` |
| `love2d.hotPollInterval` | Milliseconds between Lua-side mtime checks in `__hot__.lua`. | `500` |

## Source Layout

```text
love2d-hot-reload/
├── src/
│   ├── extension.ts        — activation and command wiring
│   ├── processManager.ts   — Love process lifecycle and output channel
│   ├── watcher.ts          — file watching and debounce
│   ├── bootstrapManager.ts — temp bootstrap generation and symlink mirroring
│   ├── reloadPolicy.ts     — save classification before restart
│   ├── logger.ts           — output channel logging helper
│   └── statusBar.ts        — status bar item
├── assets/
│   ├── bootstrap-conf.lua  — generated conf.lua template
│   ├── bootstrap-main.lua  — generated main.lua template
│   └── hot.lua             — injected Lua hot-reload layer
└── README.md
```

## Current Limitations

- The extension still restarts on every watched Lua save while the game is running.
- The Lua hot-reload layer is active and logged, but it is currently observational from
  the extension’s point of view rather than being used as the primary reload path.
- Hot-swap mode selection and project-managed `hot.lua` commands are not implemented in
  the current codebase.
