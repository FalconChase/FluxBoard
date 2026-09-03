# FLUXBOARD.md
# Project brain for FluxBoard. Hard ceiling: 120 lines. Amendment threshold: 100 lines.
# v0.1 — SES001: brain system adopted at project onboarding (repo scaffold just completed).
---
## PROJECT
NAME        : FluxBoard
DESCRIPTION : Free-canvas, infinite node-graph app — nodes are functional units connected by paths that carry items between them. Inspired by PCB layer construction and factory-building games (Factorio, Shapez.io). Strict three-layer separation: Logic / Floor / Skin.
ONBOARDED   : 2026-09-03 (brain system adopted at project start — design phase complete, pre-code)
NORTH STAR  : Milestone 1 (headless core loop) first — GraphModel + SimEngine proving item conservation/no-deadlock with one source, one sink, before any rendering work.

---
## STACK
- Tauri + React + TypeScript (app shell — not yet scaffolded, added once there's something to render)
- Canvas2D/WebGL for rendering (native, no engine dependency)
- Local data: SQLite via Tauri SQL plugin, or plain JSON — undecided (design doc §8)
- vitest for the core-logic test harness

---
## INFRA
| ITEM      | VALUE |
|-----------|-------|
| Repo path | C:\Users\ACER\Desktop\CORELOGIX\FLUXBOARD\ — git initialized at root, remote set to github.com/FalconChase/FluxBoard (main). Not yet pushed (Falcon pushes manually). |
| Local DB  | Undecided — see FBP-tracked open question in PLANS.md if/when it blocks a milestone. |

---
## PHASE
Design phase complete (design doc rev. 2, `docs/FluxBoard-design-doc.md`). Repo scaffolded this session: three-layer folder structure (`src/core` = Logic/"the brains", `src/floor`, `src/skin`, `src/app`), vitest harness, stubbed `GraphModel`/`SimEngine`/node-handler registry that throw `not implemented` (SES001). Milestone 1 not yet started.

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
| FBT001 | HIGH | Milestone 1 — implement `GraphModel` (topology) + `SimEngine` (tick loop) for one source + one sink, item `progress` as a plain number, verified via vitest (item conservation, no deadlock). No rendering. | — |

### DONE (see SESSIONS.md for full narrative detail)
| ID | PRIORITY | ITEM | SESSION |
|----|----------|------|---------|
| FBT000 | — | Repo + brain scaffold: git init, remote, `src/{core,floor,skin,app}` structure, stubbed brains files, vitest placeholder test, `_brain/` adopted from PATHWORK PRO's pattern | SES001 |

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
| FBD008 | LOCKED | Tech stack: Tauri + React + TS, local-first, zero recurring hosting cost (§8) |

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

---
# Lines: 77 / 120 — Budget remaining: 43
