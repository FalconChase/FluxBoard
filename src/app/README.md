# App shell — FluxBoard PC

Tauri + React wiring: camera, canvas, properties panels (design doc
§3, §4.6, §8). Desktop, single-user build — the current/primary
variant (see `_brain/FLUXBOARD.md` FBD009 rev.2).

Tauri-specific calls (SQL plugin, native dialogs) should stay behind
one adapter here rather than scattered through UI code — that's what
keeps a future FluxBoard Web variant (PLANS.md FBP007) a swap-the-
adapter job instead of a rewrite. Not required for this build to work;
just don't paint it out of reach for free.

## Status

Milestone 2 done as a plain Vite + React web app (`npm run dev`):
`main.tsx` (entry), `App.tsx` (demo graph + floor layout), and
`FluxCanvas.tsx` (the Canvas2D renderer — pan/zoom camera, culling,
schematic node markers, item tokens on a transparent-style path).

The `src-tauri/` desktop wrapper is not scaffolded yet — that needs a
real Rust toolchain to verify against (`FBT004`, parked). Nothing in
this folder currently calls any Tauri API, so wrapping it later is a
config/packaging step, not a rewrite.
