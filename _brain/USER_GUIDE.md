# USER_GUIDE.md
# End-user guide to FluxBoard — how to navigate and use the app itself.
# NOT developer docs (see docs/FluxBoard-design-doc.md and FLUXBOARD.md for those).
# Status: drafted ahead of the build, from the design doc. Each section is
# marked with the milestone that ships it — treat unmarked/"not yet built"
# behavior as a preview of the intended UX, not something you can do today.
---

## What FluxBoard is

A free-canvas board where you place **nodes** (functional units) and
connect them with **paths** that carry items between them — think of
wiring a small factory: sources spawn items, paths carry them, nodes
route/combine/store/consume them.

## The canvas (Milestone 2+)

- **Pan** — click-drag empty canvas space to move around. The canvas is
  infinite; nodes can be placed anywhere, not locked to a grid.
- **Zoom** — scroll/pinch to zoom in and out.
- Paths are free curves between nodes, not tile-to-tile snapping.

## Placing and connecting nodes (Milestone 5)

- Every node is an **octagon** with up to 8 ports, one per compass
  direction (N/NE/E/SE/S/SW/W/NW) — a node only shows the ports its
  type actually uses.
- **Drag-to-connect**: drag from an output port to an input port to
  wire a path between two nodes.

## Node types (Milestone 3+)

| Node | What it does |
|---|---|
| **Source** | Spawns items on a timer. Set the spawn rate in its properties panel. |
| **Distributor** | Sends each arriving item to one output (round-robin) or to all outputs (broadcast). |
| **Sorter** | Routes items by a rule list you define — first matching rule wins. Items that match nothing follow the sorter's unmatched policy (reject / default output / incinerate). |
| **Mixer** | Waits for the right combination of items across its inputs (a recipe), then consumes them and produces output. Edit the recipe in its properties panel. |
| **Buffer / Storage** | Queues items up to a capacity, draining to whatever's downstream as room allows. |
| **Overflow** | Same as Buffer, but once full, excess items divert to a second output instead of blocking. |
| **Sink** | Consumes and removes items — the end of a line. |

## Node properties panel (Milestone 5)

Click a node to open its properties panel — a convenience view over
the same data you can also see on the canvas:
- **Source**: spawn rate / cooldown
- **Sorter**: rule list, plus a gate toggle per output
- **Mixer**: recipe editor
- **Buffer/Overflow**: capacity, overflow behavior

## Path styles (Milestone 4)

Paths can look like:
- **Conveyor** — a visible belt with moving tick marks
- **Glass tube** — a translucent tube with items visible inside
- **Transparent** — just the items, no visible path

Purely visual — doesn't change how items actually flow.

## Edge gating — turning a path on/off (Milestone 5)

Any path can be gated **active/inactive** without losing its
configured flow rate — like a valve you can shut and reopen. Toggle it
either directly on the path, or from the connected node's properties
panel (handy for a sorter with several outputs).

## Bring to front / send to back (Milestone 5)

Right-click a node (or use its properties panel) to change its draw
order when nodes overlap. Cosmetic only — doesn't affect simulation.

## Isometric view (Milestone 6, stretch)

An optional camera mode that renders the same board at an angle for a
more game-like look. Toggle lives with the other camera controls
(pan/zoom). The app is fully usable without ever turning this on.

## Not yet available

Anything not listed above (undo/redo, save/load, multi-select, etc.)
isn't designed yet — see PLANS.md for what's tracked and
FLUXBOARD.md's STATE section for what's actively being built.
