# Love2D Hot Reload — VS Code Extension Spec

## Overview

A VS Code extension that enables hot reload for Love2D projects with zero mandatory
modifications to existing projects, and near-zero modifications for full state-preserving
hot swap. The extension degrades gracefully depending on what the project has opted into.

---

## Core Design Principles

- **Zero friction entry point** — works out of the box on any Love2D project with no
  changes required
- **Progressive enhancement** — one line in `main.lua` unlocks state-preserving hot swap
- **Extension owns the reload machinery** — `hot.lua` is generated and managed by the
  extension, never edited by the user
- **Fail-safe degradation** — if anything is missing or broken, falls back to kill+relaunch

---

## Reload Modes

### Mode 1 — Full Restart (default, zero modification)

Triggered when `hot.lua` is absent from the project root.

The extension watches for `.lua` file saves, kills the running Love2D process, and
relaunches it. No files are added to the project. No changes to any source files.

```
[file saved] → kill process → relaunch love <project_root>
```

State is not preserved. Suitable for early development or projects where reaching
game state is fast.

### Mode 2 — Hot Swap (opt-in, one line)

Triggered when `hot.lua` is present in the project root.

The user adds one line to `main.lua`:

```lua
pcall(require, "hot")
```

The extension drops and maintains `hot.lua` in the project root. On file save, the
extension does nothing — `hot.lua` is already polling inside the running game loop.

```
[file saved] → hot.lua detects mtime change → table-merge patch live module
```

State is preserved for module-level data. Functions are swapped in-place.

---

## Extension Behaviour

### File Watching

- Watches all `**/*.lua` files in the workspace
- Debounce: 300ms after last save before acting
- Ignores `hot.lua` itself

### On File Save — Decision Tree

```
file saved
    │
    ├─ hot.lua present in project root?
    │       │
    │       ├─ YES → do nothing (hot.lua handles it internally)
    │       │         optionally: TCP nudge to skip polling delay (future)
    │       │
    │       └─ NO  → is love process running?
    │                       │
    │                       ├─ YES → kill + relaunch
    │                       └─ NO  → launch
```

### Process Management

- Tracks the Love2D child process PID
- On kill: SIGTERM, wait 200ms, SIGKILL if still alive
- Relaunch: `love <workspaceRoot>`
- Stdout/stderr piped to VS Code Output Channel

### Commands

| Command | Description |
|---|---|
| `love2d.launch` | Launch the game |
| `love2d.stop` | Kill the running process |
| `love2d.enableHotReload` | Drop `hot.lua`, add to `.gitignore`, show the one-line instruction |
| `love2d.disableHotReload` | Remove `hot.lua`, revert to full restart mode |
| `love2d.reload` | Manually trigger a reload (mode-aware) |

### Status Bar

Shows current state: `▶ Love2D` / `⟳ Hot Swap` / `■ Stopped`

---

## `hot.lua` — Extension-Managed File

Dropped into the project root by `love2d.enableHotReload`. Added to `.gitignore`
automatically. Never shown to the user as something to edit.

### Responsibilities

- Hook into `love.update` without breaking the existing update loop
- Poll file modification times every 300ms
- On change detected: reload via table-merge patch
- Fall back to full re-require if module does not return a table
- Print reload status and errors to console

### Implementation

```lua
-- hot.lua — managed by Love2D Hot Reload extension, do not edit

local watched  = {}
local elapsed  = 0
local INTERVAL = 0.3

local function merge(live, fresh)
  if type(live) ~= "table" or type(fresh) ~= "table" then return end
  for k, v in pairs(fresh) do
    if type(v) == "function" then
      live[k] = v
    elseif type(v) == "table" and type(live[k]) == "table" then
      merge(live[k], v)
    end
    -- non-function values are left untouched: local state survives
  end
end

local function reload(modname, entry)
  local chunk, err = love.filesystem.load(entry.path)
  if not chunk then
    print("[hot] parse error in " .. modname .. ": " .. tostring(err))
    return
  end

  local ok, fresh = pcall(chunk)
  if not ok then
    print("[hot] runtime error in " .. modname .. ": " .. tostring(fresh))
    return
  end

  local live = package.loaded[modname]
  if type(fresh) == "table" and type(live) == "table" then
    merge(live, fresh)
    print("[hot] swapped: " .. modname)
  else
    -- module doesn't return a table: full re-require
    package.loaded[modname] = nil
    local rok, rerr = pcall(require, modname)
    if not rok then
      print("[hot] re-require error in " .. modname .. ": " .. tostring(rerr))
    else
      print("[hot] reloaded: " .. modname)
    end
  end
end

local function snapshot()
  for modname, _ in pairs(package.loaded) do
    if not watched[modname] then
      local path = package.searchpath(modname, package.path)
      if path then
        local info = love.filesystem.getInfo(path)
        if info then
          watched[modname] = { path = path, mtime = info.modtime }
        end
      end
    end
  end
end

local function check()
  for modname, entry in pairs(watched) do
    local info = love.filesystem.getInfo(entry.path)
    if info and info.modtime ~= entry.mtime then
      entry.mtime = info.modtime
      reload(modname, entry)
    end
  end
end

-- hook love.update non-destructively
local _update = love.update or function() end
love.update = function(dt)
  elapsed = elapsed + dt
  if elapsed >= INTERVAL then
    elapsed = 0
    check()
    snapshot()
  end
  _update(dt)
end

snapshot()
print("[hot] hot reload active")
```

---

## State Preservation Behaviour

### What survives a hot swap

Module-level data that lives in the returned table is untouched during a merge. Only
functions are replaced.

```lua
-- player.lua
local M = {}
local score = 0        -- local upvalue: SURVIVES (unreachable by merge, not reset)

function M.update(dt)  -- SWAPPED on reload
  ...
end

function M.draw()      -- SWAPPED on reload
  ...
end

return M
```

### What does not survive

Closures whose upvalues are not accessible through the returned table cannot be patched.
This is a known limitation of not using the `debug` library.

```lua
-- this pattern: state inside closure upvalue
local function makeTimer()
  local t = 0              -- unreachable from outside
  return function(dt) t = t + dt end
end
```

For state that must survive across function changes, the recommendation is to store it
in the module table rather than in closure upvalues.

### Module falls back to full re-require when

- Module does not return a table (returns a function, primitive, or nothing)
- Module errors on execution in the sandbox

Full re-require resets module-level state but does not restart the game.

---

## Extension Setup Flow

### First use (no `hot.lua`)

1. Extension activates when workspace contains `main.lua`
2. Saves trigger kill+relaunch automatically — no setup required
3. Status bar shows `▶ Love2D (restart mode)`

### Enabling hot swap

User runs `Love2D: Enable Hot Reload` command:

1. Extension writes `hot.lua` to project root
2. Extension appends `hot.lua` to `.gitignore` (creates file if absent)
3. Notification shown: `Add this line to main.lua: pcall(require, "hot")`
4. Status bar updates to `⟳ Love2D (hot swap)`

### Disabling hot swap

User runs `Love2D: Disable Hot Reload` command:

1. Extension deletes `hot.lua`
2. Extension removes `hot.lua` from `.gitignore`
3. Falls back to kill+relaunch mode automatically

---

## Extension File Layout

```
love2d-hot-reload/
├── package.json
├── src/
│   ├── extension.ts       — activation, command registration
│   ├── processManager.ts  — love process lifecycle
│   ├── watcher.ts         — file system watcher + debounce
│   ├── hotManager.ts      — hot.lua drop/remove, .gitignore management
│   └── statusBar.ts       — status bar item
├── assets/
│   └── hot.lua            — the template dropped into projects
└── README.md
```

---

## `package.json` Activation

```json
{
  "activationEvents": ["workspaceContains:main.lua"],
  "contributes": {
    "commands": [
      { "command": "love2d.launch",           "title": "Love2D: Run Game" },
      { "command": "love2d.stop",             "title": "Love2D: Stop Game" },
      { "command": "love2d.enableHotReload",  "title": "Love2D: Enable Hot Reload" },
      { "command": "love2d.disableHotReload", "title": "Love2D: Disable Hot Reload" },
      { "command": "love2d.reload",           "title": "Love2D: Reload" }
    ],
    "configuration": {
      "properties": {
        "love2d.executablePath": {
          "type": "string",
          "default": "",
          "description": "Path to love executable. Empty = auto-detect."
        },
        "love2d.reloadDebounce": {
          "type": "number",
          "default": 300,
          "description": "Milliseconds to wait after save before acting."
        },
        "love2d.hotPollInterval": {
          "type": "number",
          "default": 300,
          "description": "Milliseconds between mtime checks inside hot.lua."
        }
      }
    }
  }
}
```

---

## Future Considerations

### TCP nudge (optional upgrade)

Replace polling with a signal: extension sends a TCP message on save, `hot.lua`
responds immediately instead of waiting for the next poll tick. Reduces effective
latency from ~300ms to ~50ms. Does not change the user-facing API — still the same
one line in `main.lua`.

### `debug.upvaluejoin` patching (optional upgrade)

Extend `merge()` to use `debug.upvaluejoin` to re-wire closure upvalues between old
and new function instances. Handles the closure-upvalue case that table-merge cannot
reach. Adds ~50 lines to `hot.lua`. No user-facing changes.

### Asset reload

Detect changes to non-Lua files (`.png`, `.wav`, `.glsl`) and notify the game to
invalidate its asset cache. Requires either the TCP channel or a sentinel file.

---

## Non-Goals

- State serialization / save+restore across full restarts
- Multi-file dependency tracking (reload dependents of a changed module)
- Support for Love2D versions below 11.x
- Mobile device targets