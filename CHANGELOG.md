# Change Log

All notable changes to the "love2d-forge" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- **Project-wide Watch Scope**: New `watchScope` setting allows watching the entire workspace root.
- **Universal Asset Support**: Non-Lua file changes (images, shaders, etc.) now trigger a full game restart.
- **Smart Gitignore Integration**: Automatically respects `.gitignore` rules for file watching.
- **Improved Reload Safety**: Implemented a 1-second cooldown and busy-state detection to prevent infinite reload loops.
- **Simplified Configuration**: Renamed `location` to `locations` and streamlined the configuration schema.
- **Hot-Reload Performance**: Hot-swaps for Lua code now bypass the reload cooldown for instant feedback.
- **App Log Scope**: `print()` calls from Lua game code are now routed to their own `love2d:app` scope, separate from internal bridge messages (`love2d:bridge`). Each line displays its source file and line number (e.g. `[love2d:app:main.lua:12]`).
- **Early Print Capture**: Prints that fire during `love.load()` before the bridge connects are buffered and flushed with full source metadata once the connection is established.
- **Granular Log Filtering**: `logFilter` now supports three rule forms — level-only (`"info"`), scope-only (`"app"`), and scope+level (`"app:warn"`). A scope-only rule shows all log levels from that scope.
- **`warn` Log Type**: `print()` messages prefixed with `warn:` or `warning:` are classified as `WARN` level when `inferLogTypes` is enabled.
- **`debug` Log Type**: `print()` messages prefixed with `debug:` are classified as `DEBUG` level when `inferLogTypes` is enabled.

## [0.0.2] - 2026-04-07

- Initial release with bootstrap launch and basic Lua file watching.
