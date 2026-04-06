# Love2D Forge

![Love2D Forge icon](images/icon.png)

A Zero-Friction Entry VS Code extension for Love2D projects that launches through a bootstrap layer, watches Lua changes, and logs the reload path in the VS Code output channel.

## Features

- **Zero-Friction Entry**: Works out of the box on any Love2D project with no changes required.
- **Bootstrap Launch**: Runs the game through generated bootstrap files without modifying the project.
- **Reload Diagnostics**: Logs watcher events, debounce timing, launch reasons, process lifecycle, and Lua-side hot polling.
- **Process Management**: Integrated process control with stdout/stderr piped to the VS Code Output Channel.
- **Visual Feedback**: Real-time status bar updates for running and stopped states.

## Getting Started

1. **Launch**: Open a Love2D workspace and click the `$(debug-start) Love2D` button in the status bar or run the **Love2D: Run Game** command.
2. **Auto-Reload**: Any change to a `.lua` file while the game is running is debounced, classified, and currently handled by restarting the Love2D process.
3. **Inspect Logs**: Open the `Love2D` output channel to see `[love2d]` and `[hot]` diagnostics for change detection, process restart, and Lua-side module polling.

## Configuration

Project configuration is completely optional.

If no project config exists, Love2D Forge uses these defaults:

- `proxyErrorLogs: true`
- `inferLogTypes: true`
- `autoDiscovery: true`
- `autoDiscoverySearchDepth: 2`
- `location: undefined`
- `fileLogs.enabled: false`
- `fileLogs.outputFile: "love2d.log"`
- `fileLogs.logLines: 1000`

When you want a project config, run **Love2D: Init Config**. This creates `.love2d-forge/config.json`.

Example:

```json
{
  "proxyErrorLogs": true,
  "inferLogTypes": true,
  "autoDiscovery": true,
  "autoDiscoverySearchDepth": 2,
  "location": [
    "apps/game",
    "tools/editor/main.lua"
  ],
  "fileLogs": {
    "enabled": false,
    "outputFile": "love2d.log",
    "logLines": 1000
  }
}
```

How it works:
- `proxyErrorLogs` enables advanced error handling by proxying Love calls so critical errors are always logged.
- `inferLogTypes` classifies bridged Lua `print()` messages by prefixes like `error:`, `warn:`, or `info:`.
- `autoDiscovery` controls whether Love2D Forge scans for `main.lua` when `location` is not configured.
- `autoDiscoverySearchDepth` controls how many folder levels deep autodiscovery scans. The default is `2`.
- `location` optionally points to one app folder or `main.lua`, or a list of them. Directory values are completed to `main.lua`.
  If `location` is configured, Love2D Forge uses only those configured locations and does not mix in scanned candidates.
  Example:

  ```lua
  print("info: player spawned")
  print("warn: shader fallback in use")
  print("error: failed to load spritesheet")
  ```
- `fileLogs` controls optional persisted output logging for the last N lines.

| Setting | Description | Default |
|---|---|---|
| `love2d.executablePath` | Path to `love` executable. | `love` (auto-detects common macOS paths) |
| `love2d.reloadDebounce` | Milliseconds to wait after save before acting. | `300` |
| `love2d.hotPollInterval` | Milliseconds between mtime checks inside the injected Lua hot-reload layer. | `500` |

## Requirements

- [Love2D](https://love2d.org/) installed and in your system PATH.

## Commands

- `Love2D: Run Game`
- `Love2D: Stop Game`
- `Love2D: Restart Game`
- `Love2D: Init Config`

---
Managed and maintained by Love2D Forge.
