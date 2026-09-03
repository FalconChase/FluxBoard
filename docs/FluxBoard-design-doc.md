# FluxBoard — Project design document

**Status:** Design phase, pre-code
**Repository:** Not yet created (GitHub account available)
**Revision:** 2 — incorporates resolved decisions and new concepts from further discussion

## 1. Overview

FluxBoard is a free-canvas, infinite node-graph application where nodes are functional units connected by paths that carry items between them — a system inspired by the layered construction of a PCB and the mechanical freedom of factory-building games (Factorio, Shapez.io).

**Core design pillars:**
- **Free canvas** — nodes are placed anywhere, not locked to a grid or tiling system. Paths are curves between arbitrary points, not tile-to-tile connections.
- **2D by design** — all world data is plain `(x, y)`. Isometric is an optional *rendering projection*, never a change to the underlying data model.
- **Strict layer separation** — logic never touches pixels, floor never touches style, skin never touches simulation. Every property in the system belongs to exactly one layer.

## 2. Architecture: the three-layer model

| Layer | Owns | Never touches |
|---|---|---|
| **Logic** | Graph topology, node functions, trigger evaluation, tick engine, runtime state (counters, buffers), edge gating (active/inactive) | Pixels, coordinates, visuals |
| **Floor / ground** | World-space node positions, path curve geometry, item positions (derived from logic's abstract progress via arc-length math) | Style, color, icons |
| **Cover / skin** | Node icons or counter displays, badges, z-order (bring to front / send to back), path textures (conveyor, glass tube, transparent), color, stroke width | Simulation state, item conservation, triggers |

Each layer only reads the one below it and never writes back up. This is the core invariant the whole system is built around — when in doubt about where a new property belongs, ask: does it change what the simulation *does* (logic), where something *is* (floor), or only how it *looks* (skin)?

### Property ownership reference

| Property | Owner | Why |
|---|---|---|
| Node type, ports, recipe/rules/capacity | Logic | Functional config |
| Node runtime state (counters, buffers, cooldowns) | Logic | Mutable, drives simulation |
| Node position, base silhouette | Floor | World-space placement |
| Node icon / counter display / badge / z-order | Skin | Cosmetic view of logic state |
| Edge source/target, flow rate, active (gate on/off) | Logic | Topology + throughput — has real functional consequences |
| Edge curve geometry, item progress | Floor | World-space, derived from logic ticks |
| Edge style, color, texture, item spin mode | Skin | Cosmetic only |

## 3. Canvas and camera

- **World space vs. screen space** — nodes live in arbitrary-precision world coordinates. A camera (offset x/y, zoom) maps world → screen every frame. Pan/zoom mutates only the camera, never node data.
- **Virtualization** — a spatial index (grid hash or quadtree) maps node bounding boxes to cells so only on-screen nodes are rendered or hit-tested. This is what makes "infinite" actually performant.
- **Layers (z-order)** — nodes/paths sort into z-ordered groups; a static background layer can be cached as a bitmap and left unredrawn while an active layer repaints.

### Projection modes

The renderer supports two projections over the same world data:

- **Flat / top-down** — `screenX, screenY = worldX, worldY` (plus camera transform).
- **Isometric** — `screenX = (worldX - worldY) * cos(30°)`, `screenY = (worldX + worldY) * sin(30°)` (plus camera transform).

Consequences of adding iso mode:
- Skin assets need mode-specific art — a top-down conveyor sprite and an iso conveyor sprite are different assets, not a reused one.
- Iso introduces a depth-sorting requirement: draw order must be sorted by `worldX + worldY` each frame (painter's algorithm), or overlapping nodes occlude incorrectly. This is purely a skin/renderer concern — logic and floor layers are unaffected.
- Projection mode should live as a property of the camera, alongside offset and zoom, since pan/zoom math shifts slightly once world axes are no longer screen-aligned.
- **Open question:** manual z-order (bring to front/send to back, see §4.5) and automatic iso depth-sort will need to coexist once both exist. Likely answer: treat manual z-order as a tie-breaker on top of the automatic depth sort, not a full replacement — not needed until the iso milestone.

## 4. Node system

### 4.1 Shape: octagon

Chosen after evaluating three options against the requirement "support horizontal, vertical, and 45° diagonal flow, with ports on edges only, no corner ports":

- **Square** — only 4 edges, cannot support diagonals with edge-only ports. Rejected.
- **Hexagon** — 6 edges at 60° increments; every neighbor is equidistant (good for grid-locked, uniform-distance tiling) but doesn't align to compass/45° directions. Rejected once free-canvas was confirmed, since the tiling benefit no longer applies and the angle mismatch remains.
- **Octagon** — 8 edges, exactly 45° apart (N, NE, E, SE, S, SW, W, NW). Matches the angle requirement exactly. **Selected.**

Because the canvas is free (not grid-locked), the octagon's historical tiling gap problem (regular octagons alone don't tile a plane without a supplementary square) is irrelevant — nothing needs to tile.

Every node type uses the same octagon silhouette with up to 8 possible port sockets; a given node type only activates the sockets its arity needs (e.g. source uses 1, mixer uses 2 in + 1 out). One shape, one hit-testing routine, consistent UI across all types.

### 4.2 Node type taxonomy

| Type | Inputs | Outputs | Behavior |
|---|---|---|---|
| **Source / generator** | 0 | 1+ | Spawns items on a timer/cooldown. Needs runtime state (spawn timer). |
| **Distributor** | 1 | 2+ | Routes an arriving item to one output (round-robin, needs a remembered index) or all outputs (broadcast, stateless). |
| **Sorter** | 1 | 2+ | Routes by item property against a rule list. **Confirmed: strict first-match** — rules evaluated in order, first satisfied rule wins, item goes down exactly one output. Preserves item conservation. Unmatched (or gated-off, see §7) items follow a configurable policy (reject / default output / incinerate). |
| **Mixer / transformer** | 2+ | 1+ | Buffers arrivals per input port; fires when a recipe's required combination is present, consuming inputs and producing output(s). |
| **Buffer / storage** | 1 | 1 | Queues items up to a capacity. **Confirmed: continuous drain only for v1** (drains opportunistically whenever downstream has room). Batch/on-idle release deferred as a future `drainPolicy` variant. |
| **Overflow** | 1 | 1 + overflow | Same buffer primitive as storage, with `overflowPolicy: divert` — excess routes to a secondary output (typically an incinerator) instead of blocking upstream. |
| **Sink / incinerator** | 1+ | 0 | Consumes and deletes the item. No output. |

Storage and overflow are the *same* underlying buffer node type, differentiated only by one config flag (`overflowPolicy: 'block' | 'divert'`) — not separate implementations.

### 4.3 Shared node function contract

Every node type implements the same transition-function shape:

```
onItemArrival(item, node, state, outputEdges) => { newState, actions }
```

- **Distributor (round-robin)** — reads `state.lastIndex`, advances it, returns one send-action.
- **Distributor (broadcast)** — ignores state, returns one send-action per output edge.
- **Sorter** — finds the first matching rule, sends accordingly, or applies `unmatchedPolicy`.
- **Mixer** — pushes the item into its port buffer, checks `recipeSatisfied()`, and either waits or consumes + produces.
- **Buffer/overflow** — queues if under capacity; otherwise blocks (storage) or diverts (overflow).
- **Sink** — one line: consume, no actions.

### 4.4 Runtime state

`GraphModel` (pure topology: node/edge ids, ports, static config) is kept separate from `NodeRuntimeState` (mutable per-node data: counters, queues, cooldowns), indexed by node id. This split allows serializing/saving the graph without runtime noise, and resetting a running simulation without rebuilding topology.

### 4.5 Node display (skin layer)

- **Confirmed:** counter is a **badge overlaid on top of the icon**, not mutually exclusive with it — same under/over layering pattern the path skin stack already uses (icon = under, badge = over).
- **Confirmed:** counter is **genuinely unbounded** — no digit cap, no "999+" truncation, no compact notation. Renders whatever the runtime value is.
- **New: manual z-order control** — "bring to front / send to back" as a properties-panel or right-click action. Implemented as a `zIndex` on the node (or its decoration specifically); the skin renderer sorts its draw pass by this value. Purely cosmetic, zero effect on logic or floor. See §3 for the open question about its interaction with automatic isometric depth-sorting.

### 4.6 Node properties panels

Formalized as a system component: every node type has a properties panel that reads/writes its logic-layer config —
- Mixer: recipe editor
- Sorter: rule list editor, plus per-output edge gate toggles (see §7)
- Buffer/overflow: capacity, `overflowPolicy`
- Source: spawn rate/cooldown

Panels are a convenience view over the same underlying data an edge or node exposes directly on the canvas — never a second source of truth.

### 4.7 Item typing

**Confirmed: flat type tag for v1** — `item.type` as a single field (e.g. `'red' | 'metal' | ...`). Mixer recipes and sorter rules both match against this one field. This is a strict subset of a future open-property-bag model, so it doesn't block upgrading later — it's additive, not a redesign.

## 5. Path / edge system

### 5.1 Item movement

An item's position is computed in two stages:
1. **Logic layer** tracks a plain `progress` value (0–1) per item per edge — advanced by the tick engine, decoupled from rendering.
2. **Floor layer** maps that progress onto the edge's real bezier curve via `getPointAtLength(path, progress × totalLength)`, producing an actual `(x, y)`.

This split is what allows the simulation to run at a different rate than the render frame rate — the floor layer interpolates smoothly between logic ticks (the same technique Factorio/Satisfactory use to decouple sim tick rate from 60fps rendering).

### 5.2 Path styles: a three-pass render stack

"Transparent" is not a distinct style — it's the base state with no skin applied. Every other style is a skin layered on top of the same always-present, style-agnostic movement layer. Render order per edge:

```
1. skin-under   (drawn first  — belt body, tube fill)
2. item tokens  (always drawn here, on the transparent movement layer)
3. skin-over    (drawn last   — tube boundary/highlight lines; empty for conveyor)
```

| Style | skin-under | skin-over |
|---|---|---|
| **Conveyor** | Wide low-opacity belt stroke + perpendicular tick marks or animated dash | (empty — items sit fully on top) |
| **Glass tube** | Wide low-opacity tube-fill stroke | Thin boundary/highlight lines (painted after items, so the tube reads as translucent around them) |
| **Transparent** | (empty) | (empty) |

At scale, batch draw calls by *pass* across all edges (all skin-unders, then all items, then all skin-overs) rather than looping per-edge — groups draws by material, which matters if moving from SVG to Canvas2D/WebGL for performance.

### 5.3 Item orientation / animation modes

**Confirmed: edge-owned for v1** — `path.itemOrientation` governs how every item on that path rotates. Fewer moving parts, no item-type system required before it's strictly needed. May later become a hybrid (item type sets a default, edge can override) once item types carry more than a flat tag.

| Mode | Behavior | Formula |
|---|---|---|
| **Static** | Never rotates | `rotation = 0` |
| **Parallel** | Faces direction of travel, tangent to the curve | `rotation = angleOf(pathTangentAt(progress))` |
| **Circling** | Spins at a constant rate, independent of the path | `rotation = (elapsedTime × spinSpeed) % 360` |

### 5.4 Edge properties summary

- **Logic-owned:** source/target port, flow rate (real throughput consequences), **active gate** (see §7)
- **Floor-owned:** curve geometry, item progress
- **Skin-owned:** style (conveyor/tube/transparent), color, stroke width, item orientation mode

## 6. Simulation engine

Structurally, the source → router → transform → sink model is a **Petri net** (equivalently, flow-based programming). This isn't just terminology — it means known analysis techniques for deadlock detection (a mixer waiting forever on a type no longer being produced) and item-conservation debugging are directly applicable rather than needing to be reinvented.

**Module separation:**
- `GraphModel` — pure data, no rendering knowledge
- `SimEngine` — runs ticks over `GraphModel`, owns trigger logic, emits state deltas/events; can run headless (e.g. in a Web Worker)
- `Renderer(s)` — subscribe to `SimEngine` output, own their own camera; a schematic/debug renderer and a game-mode renderer can both read the same `GraphModel` + `SimEngine` state

## 7. Edge gating (flow gates)

New concept: edges can be deactivated — flow set to zero — without losing their configured rate.

- Modeled as a separate `active: boolean` alongside `flowRate` on the edge, rather than overwriting `flowRate` to 0. Toggling an edge back on restores whatever rate it had before, like a valve you can shut and reopen without forgetting its setting.
- **Logic-owned**, same tier as flow rate — a gated edge has real simulation consequences (stops flow, can trigger backpressure or overflow elsewhere).
- Editable from **either** the edge itself on canvas **or** the connected node's properties panel — both read/write the same single source of truth. The node-panel path is a convenience for nodes with many outputs (a sorter with four outputs shouldn't require clicking each edge individually to gate one off).
- **Open question:** what happens when a node's only viable output is gated off and an item needs to go somewhere? Proposed answer: reuse the sorter's `unmatchedPolicy` machinery — from the routing node's perspective, "the matching output is gated off" is functionally identical to "no rule matched," so the same reject/default/incinerate fallback handles both cases rather than needing new logic per node type.

## 8. Tech stack and cost

Everything below is free and open source; the project is local-first (no server), so there is no recurring hosting cost — the same pattern as the existing entERP project.

| Piece | Choice | Cost |
|---|---|---|
| App shell | Tauri | Free |
| Frontend | React + TypeScript | Free |
| Rendering | Canvas2D / WebGL (native) | Free |
| Node graph starting point (optional) | LiteGraph.js or Rete.js | Free (MIT) |
| Local data | SQLite via Tauri SQL plugin, or plain JSON | Free |
| Version control | GitHub (account already exists) | Free |
| Skin-layer art | Kenney.nl (CC0 top-down and isometric factory/tile packs) | Free |

**Only-if-you-want-them costs (all deferrable):**
- Code signing — skip it; unsigned installers just show an OS warning on first run
- Apple Developer Program — $99/year, only if distributing via the Mac App Store
- Microsoft Store — free for individual developers
- A domain name — ~$10–15/year, purely cosmetic, not required to build or use the app

## 9. Build roadmap

1. **Core loop, headless** — `GraphModel` + `SimEngine`, one source, one sink, item progress as a plain number, verified in a console test harness. No rendering. Proves the simulation math (no items lost, no deadlocks) before any graphics work.
2. **Flat canvas, one path** — infinite canvas (pan/zoom/culling) rendering one transparent-style path with a gliding item. Validates floor-layer geometry + camera together.
3. **Full node registry** — all six node types against the shared `onItemArrival` contract, still schematic rendering only.
4. **Skin layer** — icons, badges, counter display, conveyor/glass-tube path styles via the three-pass render stack.
5. **Port and interaction polish** — octagon shape with edge-aligned ports, drag-to-connect wiring, config panels (mixer recipes, sorter rules, edge gate toggles), z-order controls.
6. **Isometric mode (stretch)** — camera projection toggle, mode-specific skin assets, depth-sorted draw order reconciled with manual z-order. Fully optional — the app ships without it.

Each milestone is independently demoable; step 1 alone (before any pixel is drawn) is enough to validate whether the core simulation design holds up.

## 10. Open questions

- [ ] Open property bag for items (beyond the flat type tag) — deferred until the mixer's recipe matcher is actually being built.
- [ ] Manual z-order vs. automatic isometric depth-sort — likely resolved as a tie-breaker, not needed until the iso milestone.
- [ ] Edge-gated "no viable output" fallback — proposed to reuse `unmatchedPolicy`, not yet implemented/verified.
- [ ] Buffer `drainPolicy` on-idle variant — deferred as a future addition on top of the continuous-only v1 behavior.

## 11. Naming

Project name **FluxBoard** was selected after evaluating alternatives:
- *Fluice* (Flux + Sluice) — distinctive, `.com` already registered to an unrelated site
- *FluxMap* — nice double meaning (spatial map + functional-programming `map`), but crowded namespace, including an existing published Rust crate of the same name on crates.io

FluxBoard was chosen for combining the flow theme ("Flux") with the PCB metaphor that shaped the whole layer architecture ("Board"), with no significant naming conflicts found.
