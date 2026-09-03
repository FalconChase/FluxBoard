# Skin layer

Node icons/badges/z-order, path textures, color, item orientation
rendering (design doc §2, §4.5, §5.2, §5.3).

Milestone 4 — DONE. `octagon.ts` (edge-aligned shape + port-anchor
hints, §4.1), `nodeIcons.ts` + `nodeSkin.ts` (per-kind icon glyphs,
unbounded counter badge overlaid on the icon, z-order-sorted
`drawNode`), `pathSkin.ts` (three-pass conveyor/glass-tube/transparent
render stack + static/parallel/circling item orientation),
`SkinConfig.ts` (skin-owned node z-order + edge skin store, mirrors
`FloorLayout`'s pattern). Wired into `FluxCanvas`; badges read counters
each node kind already tracks in its own runtime state — no event
tallying on the skin side.

Not yet built: interactive z-order controls, sprite-based icons
(Kenney art), isometric-mode assets — all later milestones.
