# FLUXBOARD.md
# Project brain for FluxBoard. Hard ceiling: 120 lines. Amendment threshold: 100 lines.
# v0.1 — SES001: brain system adopted at project onboarding (repo scaffold just completed).
---
## PROJECT
NAME        : FluxBoard
DESCRIPTION : Free-canvas, infinite node-graph app — nodes are functional units connected by paths that carry items between them. Inspired by PCB layer construction and factory-building games (Factorio, Shapez.io). Strict three-layer separation: Logic / Floor / Skin.
ONBOARDED   : 2026-09-03 (brain system adopted at project start — design phase complete, pre-code)
NORTH STAR  : Milestone 1 (headless core loop) first — GraphModel + SimEngine proving item conservation/no-deadlock with one source, one sink, before any rendering work.
VARIANTS    : **FluxBoard PC** (Tauri desktop, single-user, primary/current build) and **FluxBoard Web** (Canva-style hosted web build, FBP007, future/deferred) — both share src/core+floor+skin unchanged, differ only in the src/app platform adapter.

---
## STACK
- App shell: Tauri + React + TypeScript — desktop, single-user, for Falcon's own use first (design doc §8, reaffirmed — see FBD009 rev.2).
- Canvas2D/WebGL for rendering (native, no engine dependency)
- Local data: SQLite via Tauri SQL plugin (or plain JSON) — desktop-only concern for now; see FBD010 rev.2
- vitest for the core-logic test harness
- Future, separate variant: a Canva-style hosted web build reusing src/core+floor+skin unchanged (FBP007)

---
## INFRA
| ITEM      | VALUE |
|-----------|-------|
| Repo path | C:\Users\ACER\Desktop\CORELOGIX\FLUXBOARD\ — git initialized at root, remote set to github.com/FalconChase/FluxBoard (main). Not yet pushed (Falcon pushes manually). |
| Local DB  | SQLite via Tauri SQL plugin, or plain JSON — desktop build, decide freely (FBD010 rev.2). |

---
## PHASE
Milestone 1 (headless core loop) DONE. Milestone 2 (flat canvas, one path) DONE: `src/floor/{bezier,camera,floorLayout,interpolatedSim}.ts` + `src/app/` (Vite+React dev shell — `FluxCanvas.tsx`, `App.tsx`, `main.tsx`) implemented, 20 vitest cases total passing, `npm run build`/`typecheck` clean, visually verified via headless-Chromium screenshot (staged to a cloud session since this device VM's network blocks the Playwright browser download). `npm run dev` now shows a real infinite pan/zoom canvas with an item gliding source->sink, not a placeholder. Tauri wrapping (src-tauri/) not yet scaffolded — needs a Rust toolchain this bridge VM doesn't have; deferred until Falcon can verify it on the actual machine. Milestone 3 (full node registry) not yet started.

---
## STATE

### ACTIVE
| ID | PRIORITY | ITEM | BLOCKED BY |
|----|----------|------|------------|
| —  | —        | No active items | — |

### BLOCKED
| ID | PRIORITY | ITEM | BLOCKED BY |
|----|----------|------|------------|
| —  | —        | None | — |

### NEXT
| ID | PRIORITY | ITEM | BLOCKED BY |
|----|----------|------|------------|
| FBT003 | HIGH | Milestone 3 — full node registry: distributor, sorter, mixer, buffer/overflow node kinds against the shared onItemArrival contract, still schematic rendering only (§9). | — |
| FBT004 | MED | Scaffold src-tauri/ (Tauri desktop wrapper, FBD009 rev.2) — needs verifying with a real Rust toolchain, which the cloud bridge VM used so far doesn't have. | Falcon has Rust available to test with |

### DONE (see SESSIONS.md for full narrative detail)
| ID | PRIORITY | ITEM | SESSION |
|----|----------|------|---------|
| FBT000 | — | Repo + brain scaffold: git init, remote, `src/{core,floor,skin,app}` structure, stubbed brains files, vitest placeholder test, `_brain/` adopted from PATHWORK PRO's pattern | SES001 |
| FBT001 | — | Milestone 1 — `GraphModel` + `SimEngine` implemented (source/sink node kinds, sourceTrySpawn, sink onItemArrival), verified via vitest (item conservation, no deadlock, edge-gate hold/resume) and `scripts/simHarness.ts` console harness | SES006 |
| FBT002 | — | Milestone 2 — flat canvas, one path: floor-layer curve/camera math + Vite/React canvas renderer (pan/zoom/culling, item gliding on transparent-style path), 20 vitest cases, visually verified | SES007 |

---
## DECISIONS
| ID | STATUS | DECISION |
|----|--------|----------|
| FBD001 | LOCKED | Octagon node shape — 8 edge-aligned ports, exact 45° increments (design doc §4.1) |
| FBD002 | LOCKED | Sorter uses strict first-match rule evaluation; unmatched follows configurable `unmatchedPolicy` (§4.2) |
| FBD003 | LOCKED | Buffer/overflow: continuous drain only for v1; `drainPolicy` on-idle variant deferred (§4.2, PLANS.md FBP004) |
| FBD004 | LOCKED | Item typing: flat `item.type` tag for v1, not an open property bag (§4.7, PLANS.md FBP001) |
| FBD005 | LOCKED | Item orientation mode is edge-owned for v1 (`path.itemOrientation`), not item-owned (§5.3) |
| FBD006 | LOCKED | Edge gating is a separate `active: boolean`, never overwrites `flowRate` (§7) |
| FBD007 | LOCKED | Counter is a badge overlaid on the icon (not exclusive), genuinely unbounded — no digit cap (§4.5) |
| FBD008 | LOCKED | No backend/Supabase — local-first, zero recurring hosting cost. Revisit only if cloud sync/collab is scoped in. |
| FBD009 | SUPERSEDED by rev.2 | Was: plain browser web app, no Tauri, for now. |
| FBD009 rev.2 | LOCKED | Tauri desktop app (**FluxBoard PC**) is the primary build — single-user, Falcon's own machine, free to use Tauri APIs (SQL plugin, native dialogs) normally. A Canva-style hosted web version (**FluxBoard Web**, FBP007) is a separate future variant, not a portability constraint on this build — kept cheap only by isolating Tauri-specific calls behind one adapter in src/app (never scattered through UI/core code), since src/core + src/floor + src/skin are already 100% platform-agnostic TypeScript either way. |
| FBD010 | SUPERSEDED by rev.2 | Was: no SQL, browser-native storage only. |
| FBD010 rev.2 | LOCKED | Local data: SQLite via Tauri SQL plugin (or plain JSON) — fine to decide freely, since this is the desktop-only build. A future web variant would use its own browser-storage adapter instead, not force this build's choice. |

---
## FILES
| FILE | LOCATION |
|------|----------|
| FLUXBOARD.md | /FLUXBOARD/_brain/FLUXBOARD.md |
| SESSIONS.md | /FLUXBOARD/_brain/SESSIONS.md |
| BUGS.md | /FLUXBOARD/_brain/BUGS.md |
| FIXES.md | /FLUXBOARD/_brain/FIXES.md |
| PLANS.md | /FLUXBOARD/_brain/PLANS.md |
| TEMPORARIES.md | /FLUXBOARD/_brain/TEMPORARIES.md |
| USER_GUIDE.md | /FLUXBOARD/_brain/USER_GUIDE.md — end-user app guide, not dev docs |

---
# Lines: 87 / 120 — Budget remaining: 33
