# SESSIONS.md
# FluxBoard completed session archive.
---
## SES001 — 2026-09-03 — Design doc finalized; repo + brain scaffold
Progress made    : Design doc (rev. 2) reviewed and saved to the FLUXBOARD Claude project. Confirmed open questions (§10) do not block Milestone 1. Repo initialized at C:\Users\ACER\Desktop\CORELOGIX\FLUXBOARD\ (git init, main branch, remote set to github.com/FalconChase/FluxBoard — not yet pushed, Falcon's repo). Folder structure scaffolded: src/core (Logic layer / "the brains" — GraphModel, NodeRuntimeState, SimEngine, node-handler registry, all stubbed to throw not-implemented), src/floor and src/skin (placeholder READMEs, Milestones 2 and 4), src/app (placeholder README, Tauri/React shell deferred until there's something to render). vitest + tsconfig + package.json added; one placeholder test passes. Existing design doc moved into docs/.
Items moved      : FBT000 → DONE.
Bugs found       : none.
Fixes applied    : none.
Lessons recorded : Brain folder (_brain/) adopted this session, modeled on PATHWORK PRO's _brain pattern (not copied verbatim) per Falcon's explicit request — FLUXBOARD.md, TEMPORARIES.md, BUGS.md, FIXES.md, PLANS.md, SESSIONS.md seeded from the finalized design doc and the scaffold just built. Project-local ID prefix chosen as FB (FBT/FBD/FBP/FBB/FBF), distinct from Pathwork Pro's PP and RACOS's RC/FX schemes. No SCHEMA_LIBRARY.md yet — FluxBoard's local-data choice (SQLite vs. plain JSON, design doc §8) isn't decided, so there's no schema to track; add one if/when that's picked.
Carried forward  : FBT001 (Milestone 1 core loop) sits in NEXT, not yet started.

## SES002 — 2026-09-03 — USER_GUIDE.md added
Progress made    : Wrote _brain/USER_GUIDE.md — end-user navigation/usage guide (distinct from dev docs), drafted ahead of the build straight from the design doc, each section tagged with the milestone that ships it (canvas pan/zoom, node types, properties panels, path styles, edge gating, z-order, isometric stretch). FLUXBOARD.md FILES table updated; FBP006 marked DONE in PLANS.md.
Items moved      : FBP006 → DONE.
Bugs found       : none.
Fixes applied    : none.
Lessons recorded : Guide is explicitly provisional — sections read as UX preview, not current capability, until each milestone actually ships. Update alongside each milestone rather than all at once at the end.
Carried forward  : FBT001 (Milestone 1 core loop) still the next active item.

## SES003 — 2026-09-03 — App shell revised: browser web app, not Tauri
Progress made    : Falcon clarified FluxBoard should run in a browser tab as a local single-player tool for now (like Canva but without the account/cloud layer), with installability (PWA vs. later wrapping in Tauri) deliberately left undecided. Locked as FBD009: app shell is Vite + React + TS, no Rust/Tauri, avoiding any Tauri-only API so both the PWA and future-Tauri-wrap doors stay open. This also resolved the design doc §8 "SQLite via Tauri SQL plugin, or plain JSON" question, since the Tauri SQL plugin is now off the table — locked as FBD010: no SQL, a board is one document (browser-native storage or plain JSON), same shape as Blender/Figma files, not relational records like Pathwork Pro's multi-project workspace.
Items moved      : FBD008 rephrased for clarity (no content change — still "no backend/Supabase"). New: FBD009, FBD010.
Bugs found       : none.
Fixes applied    : none.
Lessons recorded : This came out of two prior Q&A turns (does it need SQL? can it be a web app like Canva?) rather than a single ask — worth remembering the STACK/DECISIONS sections in FLUXBOARD.md are the durable record, not the chat history.
Carried forward  : FBT001 (Milestone 1 core loop) unaffected — still headless, still the next active item. Milestone 2+ (rendering) will scaffold as a Vite web app instead of `npm create tauri-app`.

## SES004 — 2026-09-03 — App shell reverted to Tauri desktop; web version deferred as separate variant
Progress made    : Falcon reconsidered — rather than one codebase staying portable to both a desktop and a Canva-style web distribution, the plan is now: build Tauri desktop app first for personal/single-user use (free to use Tauri APIs normally, no artificial restriction), and treat a Canva-style hosted web version as a wholly separate future variant if/when wanted. FBD009/FBD010 superseded by rev.2 accordingly. The one thing carried forward from the SES003 discussion: keep Tauri-specific calls (SQL plugin, native dialogs) isolated behind one adapter in src/app rather than scattered through UI code, since src/core/src/floor/src/skin are already platform-agnostic — that's what would make a future web variant (FBP007) a swap-the-adapter job instead of a rewrite, at zero cost to the desktop build.
Items moved      : FBD009 -> SUPERSEDED, FBD009 rev.2 added. FBD010 -> SUPERSEDED, FBD010 rev.2 added. New: FBP007.
Bugs found       : none.
Fixes applied    : none.
Lessons recorded : Two consecutive supersessions in one day (SES003 then SES004) on the same decision — worth deciding app-shell distribution strategy before more build work happens on top of it, not mid-stream.
Carried forward  : FBT001 (Milestone 1 core loop) still unaffected either way — it's pure src/core, no shell involved.

## SES005 — 2026-09-03 — Named the two variants: FluxBoard PC / FluxBoard Web
Progress made    : Falcon named the two build variants — **FluxBoard PC** (the Tauri desktop build, primary/current) and **FluxBoard Web** (the Canva-style hosted web build, FBP007, future). FLUXBOARD.md PROJECT section and DECISIONS (FBD009 rev.2), PLANS.md (FBP007) updated to use these names.
Items moved      : none (naming only).
Bugs found       : none.
Fixes applied    : none.
Lessons recorded : n/a.
Carried forward  : FBT001 (Milestone 1) still next — applies to both variants equally since it's src/core only.
