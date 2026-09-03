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
snap-to-grid — SES017, then Falcon's wireframe UI chrome — SES018)
done. `src-tauri/` scaffolded and verified working on Falcon's own
machine.

- `main.tsx` — entry.
- `App.tsx` — demo graph/floor layout/skin config + the three-pane
  layout (left panel | canvas | properties) + a bottom bar (Run/Hold +
  a contextual instruction strip) + selection/placement/edge-style-
  arming/snap-to-grid/canvas-settings state + the window-level
  Delete/Backspace and F8 keyboard shortcuts.
- `FluxCanvas.tsx` — the Canvas2D renderer: pan/zoom camera, culling,
  the skin layer's three-pass path render stack, octagon nodes with
  icons/badges/lock indicator, click-to-select hit-testing, click-to-
  place node creation (snap-to-grid aware), plain-drag to move a node
  (no-op if locked, snap-to-grid aware, recomputes every touching
  edge's curve live), Shift+drag for body-to-body wiring, and click-
  an-edge to apply an armed PATHS style. Exposes `toggleRunning()` via
  `forwardRef`/`useImperativeHandle` since App.tsx's Run/Hold button
  lives outside this component but the sim driver only exists inside
  its own effect.
- `LeftPanel.tsx` — NODES/PATHS/OBJECTS tab row; swaps in
  `NodePalette`/`PathPalette`/a "coming soon" OBJECTS placeholder
  below it (Falcon's wireframe: one dynamic content area, not three
  separate palettes).
- `NodePalette.tsx` — the 6 node kinds; click to arm placement mode.
- `PathPalette.tsx` — the 3 edge styles (transparent/conveyor/
  glassTube), previewed with mini canvas swatches matching
  pathSkin.ts's real alpha values; click to arm, then click an
  existing edge on the canvas to apply the style (mirrors NodePalette's
  arm-then-place flow; disarms after one application).
- `PropertiesPanel.tsx` — right-docked. A selection-editing block
  (kind-specific logic config per design doc §4.6, edge ports/
  flowRate/gate, edge skin, node z-order, a "Locked" checkbox, a
  "Delete" button) that remounts on selection change, plus an
  always-visible "Canvas & simulation" section below it (grid spacing,
  sim tick interval) that doesn't remount with the selection.
- `selection.ts` — the `Selection` type shared between the above.

Deliberately deferred: OBJECTS tab is a non-functional placeholder
(FBP011 — Falcon wants to spec the item-type registry further before
it's built). Object-type -> path-style taxonomy (FBP012) and the
wireframe's "LAYER 1-5" z-axis floor-stacking concept (FBP013) are
both future-only per Falcon. Precise per-socket wiring (FBP009's
remaining half) and lock blocking deletion (FBP010) are also still
deferred. Ribbon/tabs chrome (FBP008) resolved as out of scope beyond
LeftPanel's own NODES/PATHS/OBJECTS tabs.
