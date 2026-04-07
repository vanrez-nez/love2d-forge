# Love2D Forge

![Love2D Forge icon](images/icon.png)

A Zero-Friction Entry VS Code extension for Love2D projects that launches through a bootstrap layer, watches Lua changes, and logs the reload path in the VS Code output channel.

## Features

- **Smart File Watcher**: Automatically detects changes and triggers hot-swaps for Lua code or restarts for assets.
- **Gitignore Integration**: Automatically respects your `.gitignore` rules while allowing manual overrides.
- **Flexible Watch Scopes**: Choose between watching only the active app folder or the entire project workspace.
- **Process Management**: Integrated process control with stdout/stderr piped to the VS Code Output Channel.
- **Visual Feedback**: Real-time status bar updates for running and stopped states.
- **Granular Log Filtering**: Control exactly which logs appear in the output channel by scope (`app`, `bridge`), level (`info`, `warn`, `error`), or combinations (`app:warn`).

## Getting Started

1. **Launch**: Open a Love2D workspace and click the `$(debug-start) Love2D` button in the status bar or run the **Love2D: Run Game** command.
2. **Auto-Reload**: Any change to a `.lua` file is hot-swapped via the bridge. Changes to assets (images, shaders, etc.) trigger a full game restart.
3. **Inspect Logs**: Open the `Love2D` output channel to see `[love2d]` and `[watcher]` diagnostics for change detection and reload actions.

## Configuration

Project configuration is completely optional. If no project config exists, Love2D Forge uses these defaults:

- `proxyErrorLogs: true`
- `inferLogTypes: true`
- `autoDiscovery: true`
- `autoDiscoverySearchDepth: 2`
- `locations: undefined`
- `watchScope: "location"`
- `logFilter: ["info", "warn", "error"]`
- `fileLogs.enabled: false`
- `fileLogs.outputFile: "love2d.log"`
- `fileLogs.logLines: 1000`
- `fileLogs.sessionClear: false`
- `fileLogs.reloadClear: false`

When you want a project config, run **Love2D: Init Config**. This creates `.love2d-forge/config.json`.

Example:

```json
{
  "proxyErrorLogs": true,
  "inferLogTypes": true,
  "autoDiscovery": true,
  "autoDiscoverySearchDepth": 2,
  "locations": [
    "apps/game",
    "tools/editor"
  ],
  "watchScope": "project",
  "watchExclude": ["temp/**", "old_assets/**"],
  "logFilter": ["app", "bridge:warn"],
  "fileLogs": {
    "enabled": false,
    "outputFile": "love2d.log",
    "logLines": 1000,
    "sessionClear": false,
    "reloadClear": true
  }
}
```

How it works:
- `proxyErrorLogs` enables advanced error handling by proxying Love calls so critical errors are always logged.
- `inferLogTypes` classifies bridged Lua `print()` messages by prefixes like `error:`, `warn:`, or `info:`.
- `autoDiscovery` scans for `main.lua` when `locations` is not configured.
- `locations` optionally points to one or more app folders or `main.lua` files.
- `watchScope` controls the watcher range:
  - `"location"` (Default): Only watches files inside the active app's folder.
  - `"project"`: Watches the entire workspace, useful for shared libraries.
- `watchExclude` allows manual overrides to ignore specific files or folders. Note that **.gitignore** rules and internal extension files are always ignored automatically.
- `logFilter` sets a whitelist of rules that control which log lines are shown. Each rule is matched against the log's **scope** and **level**. Three forms are supported:

  | Form | Example | Effect |
  |---|---|---|
  | Level only | `"info"` | Show `INFO` messages from **any** scope |
  | Scope only | `"app"` | Show **all** levels from the `app` scope |
  | Scope + Level | `"app:warn"` | Show only `WARN` from the `app` scope |
  | Wildcard | `"*"` | Show everything |

  **Scopes** in the output channel:
  - `love2d:app` — `print()` calls from your Lua game code. Each line also shows the source file and line, e.g. `[love2d:app:main.lua:12]`, but only `app` is needed for filtering.
  - `love2d:bridge` — Internal bridge lifecycle messages (connected, reloaded, errors).
  - `love2d:process` — OS process management (spawning, stdout/stderr).
  - `love2d:watcher` — File watcher events (change detected, reload triggered).
  - `love2d:extension` — Extension lifecycle (status bar, config load).

  **Log levels** (from noisiest to most critical): `trace`, `debug`, `info`, `warn`, `error`.

  **`inferLogTypes`** classifies bridged `print()` calls by their message prefix:
  - Messages starting with `error:` → logged as `ERROR`
  - Messages starting with `warn:` or `warning:` → logged as `WARN`
  - Messages starting with `info:` → logged as `INFO`
  - Messages starting with `debug:` → logged as `DEBUG`
  - Anything else → logged as `INFO`

  **Common filter recipes:**

  ```json
  "logFilter": ["info", "warn", "error"]
  ```
  > Default. Shows all levels ≥ INFO from every scope.

  ```json
  "logFilter": ["app"]
  ```
  > Only your game's `print()` output. Hides all bridge/process/watcher noise.

  ```json
  "logFilter": ["app", "bridge:warn"]
  ```
  > Game prints at all levels + only warnings/errors from the bridge.

  ```json
  "logFilter": ["app:warn", "app:error"]
  ```
  > Only warnings and errors from your game. Suppress info-level prints.

  ```json
  "logFilter": ["*"]
  ```
  > Everything. Useful for debugging the extension itself.

- `fileLogs` controls optional persisted output logging for the last N lines.
  - `enabled`: Toggles file logging.
  - `outputFile`: Path to the log file.
  - `logLines`: Maximum lines to keep.
  - `sessionClear`: If `true`, the log file is wiped clean at the start of every manual session or manual restart.
  - `reloadClear`: If `true`, the log file is wiped clean only when an automatic hard-reload is triggered by the file watcher.

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
