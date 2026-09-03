# App shell — FluxBoard PC

Tauri + React wiring: camera, canvas, node palette, properties panel
(design doc §3, §4.6, §8). Desktop, single-user build — the
current/primary variant (see `_brain/FLUXBOARD.md` FBD009 rev.2).

Tauri-specific calls (SQL plugin, native dialogs) should stay behind
one adapter here rather than scattered through UI code — that's what
keeps a future FluxBoard Web variant (PLANS.md FBP007) a swap-the-
adapter job instead of a rewrite. Not required for this build to work;
just don't paint it out of reach for free.

## Status

Milestones 1-5 (minimal-chrome scope) done. `src-tauri/` scaffolded
and verified working on Falcon's own machine.

- `main.tsx` — entry.
- `App.tsx` — demo graph/floor layout/skin config + the three-pane
  layout (palette | canvas | properties) + selection/placement state.
- `FluxCanvas.tsx` — the Canvas2D renderer: pan/zoom camera, culling,
  the skin layer's three-pass path render stack, octagon nodes with
  icons/badges, RUN/HOLD, and (Milestone 5) click-to-select hit-
  testing, click-to-place node creation, body-to-body drag wiring.
- `NodePalette.tsx` — left-docked list of the 6 node kinds; click to
  arm placement mode.
- `PropertiesPanel.tsx` — right-docked editor for whatever's selected:
  kind-specific logic config (design doc §4.6), edge ports/flowRate/
  gate, edge skin (style/color/orientation), node z-order.
- `selection.ts` — the `Selection` type shared between the three.

Deliberately deferred (FBP009): precise per-socket wiring (drag from
one of the octagon's 8 port anchors specifically, not just the node
body) and node/edge deletion from the UI. Ribbon/tabs chrome (FBP008)
resolved as out of scope — nothing yet justifies more than these two
docked panels.
