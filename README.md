# orca-discord-presence

A Discord Rich Presence plugin for Orca ADE. The goal is to show what you are currently doing in Orca as your Discord status.

## Status

The project is in early development. No features are implemented yet, and this README is the only file in the repository.

## Goal

The plugin is intended to show Orca ADE activity in Discord, such as:

- currently using Orca ADE
- active workspace/project
- git branch
- agent activity/status, when it is available through the Orca plugin API
- elapsed activity time

This is an Orca ADE plugin, not a standalone Discord application.

## Development

The plugin will be developed against Orca ADE's plugin system and tested locally by adding the plugin path in Orca ADE:

```
Orca ADE
→ Settings
→ Plugins
→ Development
→ Add path
```
