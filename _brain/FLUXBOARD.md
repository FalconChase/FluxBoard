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
- Local data: plain JSON, autosaved via Tauri fs plugin — FBD010 rev.3, implemented (`app/persistence.ts`)
- vitest for the core-logic test harness
- Future, separate variant: a Canva-style hosted web build reusing src/core+floor+skin unchanged (FBP007)

---
## INFRA
| ITEM      | VALUE |
|-----------|-------|
| Repo path | C:\Users\ACER\Desktop\CORELOGIX\FLUXBOARD\ — git initialized at root, remote set to github.com/FalconChase/FluxBoard (main). Not yet pushed (Falcon pushes manually). |
| Local data | Plain JSON, one file per project under `%AppData%/<id>/projects/`, + a manifest (FBD010 rev.3, FBT018). |

---
## PHASE
Milestones 1-5 DONE. M5 minimal-chrome scope (FBP008) extended with drag-to-move/lock/delete/snap-to-grid, Falcon's wireframe UI chrome, per-socket wiring (FBP009 resolved), path type, merger node, and autosave persistence (FBD010 rev.3). Falcon to verify locally (tsc clean from the bridge; npm test/tauri:dev not runnable here) — persistence's Rust/Cargo side unverified from the bridge specifically.

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
| —  | —        | Falcon to verify the FILE tab + persistence end-to-end locally, then decide: Tools tab (multi-select/move, rest of FBP014), spec the OBJECTS registry (FBP011), Milestone 6 (isometric, stretch), or something else. | — |

### DONE (see SESSIONS.md for full narrative detail)
| ID | PRIORITY | ITEM | SESSION |
|----|----------|------|---------|
| FBT000 | — | Repo+brain scaffold (SES001); Milestone 1 GraphModel+SimEngine (source/sink, item conservation, SES006); Milestone 2 flat canvas (curve/camera math, pan/zoom, SES007); src-tauri/ scaffolded + verified `tauri:dev` opens the real desktop window (SES008/009); RUN/HOLD button (SES010). | SES001-010 |
| FBT003 | — | Milestone 3 — full node registry: `distributor` (round-robin/broadcast), `sorter` (first-match rules + unmatchedPolicy, resolves FBP003), `mixer` (per-port buffered recipe matching), `buffer` (capacity + block/divert overflow + continuous tryDrain). Extended the shared contract (`accepted?`, `'forward'` action, `arrivalEdge`+`makeItemId` params, `tryDrain` hook). 17 new vitest cases (verified via `npm test`, SES012). | SES011 |
| FBT007 | — | Milestone 4 — skin layer: octagon shapes (edge-aligned ports, §4.1), per-kind icons + unbounded counter badges (§4.5, read each node's own existing runtime counters, no separate tally), z-order-sortable node draw, three-pass conveyor/glass-tube/transparent path stack + static/parallel/circling item orientation (§5.2, §5.3). Small counters added to source/distributor/sorter/mixer state; `GraphModel.getAllEdges()`. Demo graph expanded to exercise all edge styles + orientation modes. | SES013 |
| FBT008 | — | Milestone 5, minimal-chrome scope (FBP008 resolved): selection + hit-testing (`isPointInOctagon`), left-docked node palette (click-to-place), right-docked properties panel (kind-specific logic config, edge ports/flowRate/gate, edge skin, node z-order), body-to-body drag wiring. `GraphModel.updateNodeConfig`/`setEdgeFlowRate`/`updateEdgePorts` added. Precise per-socket wiring + node/edge deletion deferred (FBP009). | SES016 |
| FBT009 | — | Move/lock/delete/snap-to-grid: plain drag now moves a node (Shift+drag wires instead), lock toggle blocks it, Delete/Backspace + panel button remove a node (cascading its edges) or edge, F8/header toggle snaps drag+placement to the grid. `GraphModel.removeNode/removeEdge`, `FloorLayout.removeNodePosition/recomputeEdgeCurve/removeEdgeCurve`, `SkinConfig.getNodeLocked/setNodeLocked/removeNode/removeEdge`, lock badge icon. Resolves FBP009's deletion half; socket-precise wiring still deferred. | SES017 |
| FBT010 | — | UI-chrome build from Falcon's wireframe (claude/build-log.md): left panel is now NODES/PATHS/OBJECTS tabs (PATHS = new palette of the 3 edge styles, arm-then-click-an-edge to apply, mirrors node placement; OBJECTS = "coming soon" placeholder pending spec). Properties panel gained an always-visible "Canvas & simulation" section (grid spacing, sim tick interval) below the selection editor, surviving selection changes via an inner remount key. Bottom bar relocates Run/Hold and adds a contextual instruction strip, replacing the old floating placement hint. | SES018 |
| FBT011 | — | Per-socket wiring (FBP009 fully resolved): 8 octagon-side anchors per node, a path attaches to the nearest free one at each end (max 8 per node), `FloorLayout` owns the booking independent of GraphModel's routing ports. Path direction arrows (always drawn, even on 'transparent' style). Node badges now buffer-only (Falcon: only a genuine "silo" node should show a count) — `getBadgeCount` returns undefined for every other kind; underlying RuntimeState counters untouched. | SES019 |
| FBT012 | — | Per-kind "nature" port caps (`core/nodes/portCapacity.ts`, grounded in each handler's real behavior): source 1 output, mixer 1 output, buffer 2 outputs, sink/distributor/sorter uncapped — enforced as a silent hard reject in `handleCreateEdge`, same style as the 8-socket structural cap. Properties panel gained a compass-style `SingleOutputSidePicker` so a capped-output node's one side is chosen by click, not rotation. | SES020 |
| FBT013 | — | Freeform planning sketches (`app/sketchLayer.ts`): pure visual dashed-line scratch paths, deliberately OUTSIDE Logic/Floor/Skin — no simulation meaning, not a GraphModel edge. Armed from a new PATHS-tab button; a drag (not a click) commits one, mutually exclusive with node/edge-style arming. Selectable/deletable like a real path. | SES021 |
| FBT014 | — | Path type: linear (straight, bow=0) vs curve (bow!=0) — `FloorLayout.getEdgeBow`/`setEdgeBow`, a "Path type" dropdown on the edge properties panel. New edges still default to curve. | SES022 |
| FBT015 | — | New node kind `merger` — opposite of distributor: many inputs (uncapped) merge into one output (capped, `portCapacity.ts`). Pure pass-through, no config, no badge (not a silo). `core/nodes/merger.ts`. | SES023 |
| FBT016 | — | Autosave persistence (FBD010 rev.3): `app/persistence.ts` serializes the 4 stores to plain JSON, `saveToDisk`/`loadFromDisk` via Tauri fs plugin (AppData dir). App.tsx keeps its stable store singletons, load clears+repopulates them in place; autosaves every 3s + on tab-hidden/pagehide. | SES024 |
| FBT017 | — | Edge properties gained a "Speed" field (world units/sec), converted to/from `flowRate` using the edge's current path length (UI-layer only, no stored field/SimEngine change) — explains/fixes "longer path looks faster" (`flowRate` is length-independent progress/sec by design, §5.1). Grid spacing now defaults to 8 (was 64), snap-to-grid on by default (was off). | SES025 |
| FBT018 | — | FILE tab (FBP014 half-resolved): persistence.ts's single fixed save file becomes a manifest + one JSON file per project (`projects/<id>.json`) — create/switch/rename/delete, legacy autosave migrated into a project on first load under this. Tools tab (multi-select/move) still deferred. | SES026 |

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
| FBD010 rev.2 | SUPERSEDED by rev.3 | Was: SQLite or plain JSON, decide freely. |
| FBD010 rev.3 | LOCKED | Plain JSON, autosaved (not SQLite, not manual save/load) — Falcon confirmed via AskUserQuestion, 2026-09-03. One fixed save file today; multiple named projects is a future File tab (PLANS.md). |

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
# Lines: 98 / 120 — Budget remaining: 22
