# App shell

Tauri + React wiring: camera, canvas, properties panels (design doc
§3, §4.6, §8). Desktop, single-user build for now (see
`_brain/FLUXBOARD.md` FBD009 rev.2).

Tauri-specific calls (SQL plugin, native dialogs) should stay behind
one adapter here rather than scattered through UI code — that's what
keeps a future Canva-style web variant (PLANS.md FBP007) a swap-the-
adapter job instead of a rewrite. Not required for this build to work;
just don't paint it out of reach for free.

Not started.
