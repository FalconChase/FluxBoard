# FluxBoard

Free-canvas, infinite node-graph app where nodes are functional units
connected by paths that carry items between them — a system inspired by
the layered construction of a PCB and the mechanical freedom of
factory-building games (Factorio, Shapez.io).

Full design: [`docs/FluxBoard-design-doc.md`](docs/FluxBoard-design-doc.md).

Project brain (working memory, decisions, session log): [`_brain/FLUXBOARD.md`](_brain/FLUXBOARD.md).

## Architecture

Three strictly separated layers (never violate this — see the design
doc §2 for the full ownership table):

- **`src/core/`** — Logic layer ("the brains"): graph topology, node
  functions, tick engine, runtime state. No pixels, no coordinates.
- **`src/floor/`** — Floor layer: world-space positions, path
  geometry, item positions. No style.
- **`src/skin/`** — Skin layer: icons, colors, textures, z-order. No
  simulation state.
- **`src/app/`** — Tauri + React shell for **FluxBoard PC** (desktop, single-user, current build). Tauri-specific calls stay isolated behind one adapter so a future **FluxBoard Web** variant can swap it out later without touching core/floor/skin (see `_brain/FLUXBOARD.md` FBD009 rev.2).

## Status

Pre-code, design phase complete. Building Milestone 1 (design doc §9):
a headless `GraphModel` + `SimEngine` with one source and one sink,
verified in a console/vitest test harness — no rendering yet.

## Dev setup

```
npm install
npm test        # run once
npm run test:watch
npm run typecheck
```

(The Tauri/React app shell is added in a later milestone once there's a
graph to render. See `_brain/FLUXBOARD.md` FBD009 rev.2/FBD010 rev.2.)
