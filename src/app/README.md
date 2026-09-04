# App shell — FluxBoard PC

Tauri + React wiring: camera, canvas, left panel, properties panel
(design doc §3, §4.6, §8). Desktop, single-user build — the
current/primary variant (see `_brain/FLUXBOARD.md` FBD009 rev.2).

Tauri-specific calls (SQL plugin, native dialogs) should stay behind
one adapter here rather than scattered through UI code — that's what
keeps a future FluxBoard Web variant (PLANS.md FBP007) a swap-the-
adapter job instead of a rewrite. Not required for this build to work;
just don't paint it out of reach for free.

## Status

Milestones 1-5 (minimal-chrome scope, extended with move/lock/delete/
snap-to-grid — SES017, Falcon's wireframe UI chrome — SES018, then
per-socket wiring/direction arrows/storage-only badges — SES019) done.
`src-tauri/` scaffolded and verified working on Falcon's own machine.

- `main.tsx` — entry.
- `App.tsx` — demo graph/floor layout/skin config + the three-pane
  layout (left panel | canvas | properties) + a bottom bar (Run/Hold +
  a contextual instruction strip) + selection/placement/edge-style-
  arming/snap-to-grid/canvas-settings state + the window-level
  Delete/Backspace and F8 keyboard shortcuts. `handleCreateEdge` checks
  `FloorLayout.hasFreeAnchorSlot` on both nodes before ever creating a
  GraphModel edge, so a full node (8 paths already) silently rejects a
  9th. Two more mount effects (SES024): one loads any
  autosaved graph and repopulates the same graph/floorLayout/
  skinConfig/sketchLayer instances in place (leaving the demo graph
  alone on first run), the other autosaves on a timer plus tab-hidden/
  pagehide — see `persistence.ts`.
- `FluxCanvas.tsx` — the Canvas2D renderer: pan/zoom camera, culling,
  the skin layer's three-pass path render stack plus a direction arrow
  on every path, octagon nodes with icons/badges/lock indicator,
  click-to-select hit-testing, click-to-place node creation (snap-to-
  grid aware), plain-drag to move a node (no-op if locked, snap-to-grid
  aware, recomputes every touching edge's curve live — staying on the
  same octagon side it was originally wired to), Shift+drag for
  per-socket wiring (auto-picks the nearest free side at each end), and
  click-an-edge to apply an armed PATHS style. Exposes `toggleRunning()`
  via `forwardRef`/`useImperativeHandle` since App.tsx's Run/Hold button
  lives outside this component but the sim driver only exists inside
  its own effect.
- `LeftPanel.tsx` — NODES/PATHS/OBJECTS/FILE tab row; swaps in
  `NodePalette`/`PathPalette`/a "coming soon" OBJECTS placeholder/
  `FileTab` below it (Falcon's wireframe: one dynamic content area,
  not separate palettes per tab). FILE added SES026 (FBP014, half-
  resolved — see `FileTab.tsx` below; the Tools tab, the other half
  of FBP014, is still deferred).
- `NodePalette.tsx` — the 7 node kinds (source, distributor, merger,
  sorter, mixer, buffer, sink); click to arm placement mode.
- `PathPalette.tsx` — the 3 edge styles (transparent/conveyor/
  glassTube), previewed with mini canvas swatches matching
  pathSkin.ts's real alpha values; click to arm, then click an
  existing edge on the canvas to apply the style (mirrors NodePalette's
  arm-then-place flow; disarms after one application). Also has a
  "Sketch a path" toggle that arms `sketchArmed` instead (see
  `sketchLayer.ts` below) — mutually exclusive with the style swatches
  and with NodePalette's placement arming.
- `PropertiesPanel.tsx` — right-docked. A selection-editing block
  (kind-specific logic config per design doc §4.6, edge ports/
  flowRate/gate, a Linear/Curve path-type dropdown (floor-layer
  geometry — see `floorLayout.ts`'s `getEdgeBow`/`setEdgeBow`), edge
  skin, node z-order, a "Locked" checkbox, a "Delete" button, a
  compass-style output side picker for kinds capped at 1 output, a
  minimal "planning only" view + Delete for a sketch selection) that
  remounts on selection change, plus an always-visible "Canvas &
  simulation" section below it (grid spacing, sim tick interval) that
  doesn't remount with the selection.
- `selection.ts` — the `Selection` type shared between the above:
  `'node'`, `'edge'`, or `'sketch'`.
- `persistence.ts` — save/load (Falcon, 2026-09-03: "my progress lost
  or gets unsaved... why is this?"). `serializeState` reads the four
  live stores into one plain-JSON snapshot; `clearAllStores`/
  `populateState` empty and refill those SAME instances in place
  (never fresh ones — App.tsx keeps its stable singletons across a
  load). SES026 (FBP014, "the file tab... create new projects,
  manages, and contains the existing/saved projects") turned the
  original single fixed-filename autosave into a small manifest
  (`fluxboard-projects.json` — which projects exist, their names,
  last-opened time, which one is active) plus one JSON save file per
  project (`projects/<id>.json`): `loadManifest`/`saveManifest`,
  `loadProjectFile`/`saveProjectFile`/`deleteProjectFile`,
  `makeBlankProjectData` (a genuinely empty graph for "+ New
  project," not the demo graph), `newProjectId`. `loadLegacySave`
  reads the old fixed filename ONLY once, to migrate a pre-SES026
  autosave into the new system's first project on load. All of it
  wraps `@tauri-apps/plugin-fs`, scoped to the app's own AppData dir,
  no-op outside the real Tauri shell (plain `npm run dev`).
- `sketchLayer.ts` — pure visual planning sketches (Falcon, 2026-09-03:
  "draw paths without really needing node... freedom to plan the
  paths"). `Sketch {id, from, to}` + `SketchLayer` CRUD, deliberately
  OUTSIDE the Logic/Floor/Skin architecture — no simulation meaning,
  not a GraphModel edge, never carries items. Armed from PathPalette;
  committed only by an actual drag on the canvas (a plain click while
  armed draws nothing), rendered as a dashed purple/violet line so it
  reads as a background guide rather than a real path.
- `FileTab.tsx` — the FILE tab (SES026, FBP014 half-resolved). Lists
  every project the manifest knows about (`persistence.ts`), newest-
  opened first; "+ New project" (`window.prompt` for a name) creates a
  genuinely blank project via `makeBlankProjectData`; clicking a
  non-active project switches to it (App.tsx flushes the current
  project's autosave first via `handleSwitchProject`); rename/delete
  use `window.prompt`/`window.confirm`. Delete is disabled for the
  currently active project so App.tsx never has to handle "what
  replaces the open canvas mid-delete."

Per-socket wiring lives mostly in `src/floor/floorLayout.ts`, not here
— see that file's own header comment for the anchor-booking design
(kept deliberately independent of GraphModel's sourcePort/targetPort
routing integers). Node badges (`src/skin/nodeSkin.ts`'s
`getBadgeCount`) now only appear on buffer nodes — the only kind that
actually holds items — per Falcon's framing that a pass-through node
(source/sink/distributor/sorter/mixer) has nothing worth counting.

Per-kind "nature" port caps live in `core/nodes/portCapacity.ts`
(source/mixer 1 output, buffer 2 outputs, sink/distributor/sorter
uncapped) — grounded in each handler's real `onItemArrival`/`trySpawn`
behavior, enforced as a silent hard reject in `App.tsx`'s
`handleCreateEdge` alongside the existing 8-socket structural cap.

Deliberately deferred: OBJECTS tab is a non-functional placeholder
(FBP011 — Falcon wants to spec the item-type registry further before
it's built). Object-type -> path-style taxonomy (FBP012) and the
wireframe's "LAYER 1-5" z-axis floor-stacking concept (FBP013) are
both future-only per Falcon. Lock blocking deletion (FBP010) is also
still deferred. Ribbon/tabs chrome (FBP008) resolved as out of scope
beyond LeftPanel's own NODES/PATHS/OBJECTS/FILE tabs. FBP009
(per-socket wiring + deletion) is now fully resolved. FBP014 is half-
resolved: the FILE tab (multi-project persistence) is done (SES026);
a Tools tab (multiple-selection tool, move tool) remains deferred,
not started, per Falcon's own "we can introduce more on later
builds" — do not build it without an explicit further request.
