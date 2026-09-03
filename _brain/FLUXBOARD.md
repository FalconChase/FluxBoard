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
Milestones 1-5 DONE (M4 had 2 post-ship bugfixes, both fixed). M5 minimal-chrome scope (FBP008) extended with drag-to-move/lock/delete/snap-to-grid, Falcon's wireframe UI chrome, then per-socket wiring (FBP009 fully resolved), path direction arrows, and storage-only node badges. Falcon to verify locally (tsc clean from the bridge; npm test/tauri:dev not runnable here).

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
| —  | —        | Falcon to try the latest build locally (per-socket wiring, direction arrows, badge changes) and decide what's next: spec the OBJECTS registry (FBP011), Milestone 6 (isometric, stretch), or something else entirely. | — |

### DONE (see SESSIONS.md for full narrative detail)
| ID | PRIORITY | ITEM | SESSION |
|----|----------|------|---------|
| FBT000 | — | Repo + brain scaffold: git init, remote, `src/{core,floor,skin,app}` structure, stubbed brains files, vitest placeholder test, `_brain/` adopted from PATHWORK PRO's pattern | SES001 |
| FBT001 | — | Milestone 1 — `GraphModel` + `SimEngine` implemented (source/sink node kinds, sourceTrySpawn, sink onItemArrival), verified via vitest (item conservation, no deadlock, edge-gate hold/resume) and `scripts/simHarness.ts` console harness | SES006 |
| FBT002 | — | Milestone 2 — flat canvas, one path: floor-layer curve/camera math + Vite/React canvas renderer (pan/zoom/culling, item gliding on transparent-style path), 20 vitest cases, visually verified | SES007 |
| FBT004 | — | Scaffold src-tauri/ (Tauri desktop wrapper) via `tauri init` — devUrl/frontendDist wired to the existing Vite app, identifier set, Cargo.toml details filled in | SES008 |
| FBT005 | — | Verified `npm run tauri:dev` opens the actual FluxBoard PC desktop window on Falcon's machine, rendering the Milestone 2 canvas correctly. Cargo.lock committed. | SES009 |
| FBT006 | — | RUN/HOLD button on the canvas: `InterpolatedSimDriver.pause()/resume()/isRunning()`, freezes items in place, resumes without a jump. | SES010 |
| FBT003 | — | Milestone 3 — full node registry: `distributor` (round-robin/broadcast), `sorter` (first-match rules + unmatchedPolicy, resolves FBP003), `mixer` (per-port buffered recipe matching), `buffer` (capacity + block/divert overflow + continuous tryDrain). Extended the shared contract (`accepted?`, `'forward'` action, `arrivalEdge`+`makeItemId` params, `tryDrain` hook). 17 new vitest cases (verified via `npm test`, SES012). | SES011 |
| FBT007 | — | Milestone 4 — skin layer: octagon shapes (edge-aligned ports, §4.1), per-kind icons + unbounded counter badges (§4.5, read each node's own existing runtime counters, no separate tally), z-order-sortable node draw, three-pass conveyor/glass-tube/transparent path stack + static/parallel/circling item orientation (§5.2, §5.3). Small counters added to source/distributor/sorter/mixer state; `GraphModel.getAllEdges()`. Demo graph expanded to exercise all edge styles + orientation modes. | SES013 |
| FBT008 | — | Milestone 5, minimal-chrome scope (FBP008 resolved): selection + hit-testing (`isPointInOctagon`), left-docked node palette (click-to-place), right-docked properties panel (kind-specific logic config, edge ports/flowRate/gate, edge skin, node z-order), body-to-body drag wiring. `GraphModel.updateNodeConfig`/`setEdgeFlowRate`/`updateEdgePorts` added. Precise per-socket wiring + node/edge deletion deferred (FBP009). | SES016 |
| FBT009 | — | Move/lock/delete/snap-to-grid: plain drag now moves a node (Shift+drag wires instead), lock toggle blocks it, Delete/Backspace + panel button remove a node (cascading its edges) or edge, F8/header toggle snaps drag+placement to the grid. `GraphModel.removeNode/removeEdge`, `FloorLayout.removeNodePosition/recomputeEdgeCurve/removeEdgeCurve`, `SkinConfig.getNodeLocked/setNodeLocked/removeNode/removeEdge`, lock badge icon. Resolves FBP009's deletion half; socket-precise wiring still deferred. | SES017 |
| FBT010 | — | UI-chrome build from Falcon's wireframe (claude/build-log.md): left panel is now NODES/PATHS/OBJECTS tabs (PATHS = new palette of the 3 edge styles, arm-then-click-an-edge to apply, mirrors node placement; OBJECTS = "coming soon" placeholder pending spec). Properties panel gained an always-visible "Canvas & simulation" section (grid spacing, sim tick interval) below the selection editor, surviving selection changes via an inner remount key. Bottom bar relocates Run/Hold and adds a contextual instruction strip, replacing the old floating placement hint. | SES018 |
| FBT011 | — | Per-socket wiring (FBP009 fully resolved): 8 octagon-side anchors per node, a path attaches to the nearest free one at each end (max 8 per node), `FloorLayout` owns the booking independent of GraphModel's routing ports. Path direction arrows (always drawn, even on 'transparent' style). Node badges now buffer-only (Falcon: only a genuine "silo" node should show a count) — `getBadgeCount` returns undefined for every other kind; underlying RuntimeState counters untouched. | SES019 |
| FBT012 | — | Per-kind "nature" port caps (`core/nodes/portCapacity.ts`, grounded in each handler's real behavior): source 1 output, mixer 1 output, buffer 2 outputs, sink/distributor/sorter uncapped — enforced as a silent hard reject in `handleCreateEdge`, same style as the 8-socket structural cap. Properties panel gained a compass-style `SingleOutputSidePicker` so a capped-output node's one side is chosen by click, not rotation. | SES020 |
| FBT013 | — | Freeform planning sketches (`app/sketchLayer.ts`): pure visual dashed-line scratch paths, deliberately OUTSIDE Logic/Floor/Skin — no simulation meaning, not a GraphModel edge. Armed from a new PATHS-tab button; a drag (not a click) commits one, mutually exclusive with node/edge-style arming. Selectable/deletable like a real path. | SES021 |

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
# Lines: 97 / 120 — Budget remaining: 23
