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
- **`src/app/`** — browser web app shell (Vite + React + TS) tying the above together. No Tauri for now; kept portable to a later PWA or Tauri wrap (see `_brain/FLUXBOARD.md` FBD009).

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

(The web app shell — Vite + React + TS, running in a browser tab, no
install required — is added in a later milestone once there's a graph
to render. See `_brain/FLUXBOARD.md` FBD009/FBD010 for why it's a
plain web app rather than Tauri.)
