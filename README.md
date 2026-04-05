# Love2D Hot Reload

A VS Code extension that enables hot reload for Love2D projects with zero mandatory modifications to existing projects, and near-zero modifications for full state-preserving hot swap.

## Features

- **Zero-Friction Entry**: Works out of the box on any Love2D project with no changes required.
- **Two Reload modes**:
  - **Full Restart (Default)**: Automatically kills and relaunches the game on save.
  - **Hot Swap (Opt-in)**: Live-patches your running game while preserving state.
- **Process Management**: Integrated process control with stdout/stderr piped to the VS Code Output Channel.
- **Managed Assets**: Automatically manages the `.love2d-hot/hot.lua` script and your `.gitignore`.
- **Visual Feedback**: Real-time status bar updates (`▶ Love2D`, `⟳ Hot Swap`, `■ Stopped`).

## Getting Started

1. **Launch**: Open a folder with a `main.lua` and click the `$(debug-start) Love2D` button in the status bar or run the **Love2D: Run Game** command.
2. **Auto-Reload**: By default, any change to a `.lua` file will restart the game.

## Enabling Hot Swap (State-Preserving)

To preserve game state across reloads:

1. Run the command **Love2D: Enable Hot Reload**.
2. Add this line to the top of your `main.lua`:
   ```lua
   pcall(require, ".love2d-hot.hot")
   ```
3. Now, instead of restarting, the extension will live-patch changed modules. Functions will be swapped in-place, while local state in module tables is preserved.

## Configuration

| Setting | Description | Default |
|---|---|---|
| `love2d.executablePath` | Path to `love` executable. | `love` (auto-detects common macOS paths) |
| `love2d.reloadDebounce` | Milliseconds to wait after save before acting. | `300` |
| `love2d.hotPollInterval` | Milliseconds between mtime checks in hot-swap mode. | `300` |

## Commands

- `Love2D: Run Game`
- `Love2D: Stop Game`
- `Love2D: Enable Hot Reload`
- `Love2D: Disable Hot Reload`
- `Love2D: Reload` (Force manual reload)

## Requirements

- [Love2D](https://love2d.org/) installed and in your system PATH.

---
Managed and maintained by the Love2D Hot Reload Extension.
