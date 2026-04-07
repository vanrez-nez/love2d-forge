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

## [0.0.2] - 2026-04-07

- Initial release with bootstrap launch and basic Lua file watching.
