# PLANS.md
# FluxBoard backlog — deferred builds and features not yet in active scope.
# Promotion to TEMPORARIES.md/FLUXBOARD.md STATE requires explicit Falcon instruction.
---
FBP001 | DEFERRED | Open property bag for items (beyond flat type tag, design doc §4.7) — deferred until the mixer's recipe matcher is actually being built (Milestone 3+)
FBP002 | DEFERRED | Manual z-order vs. automatic isometric depth-sort reconciliation (design doc §3, §4.5) — proposed answer: manual z-order as tie-breaker on top of auto depth-sort; not needed until the iso milestone (6)
FBP003 | IMPLEMENTED | Edge-gated "no viable output" fallback (design doc §7) — implemented in the sorter (SES011): a matched-but-gated-off output edge is treated the same as an unmatched item, subject to unmatchedPolicy ('hold' parks/retries, 'drop' destroys + tracks droppedCount)
FBP004 | DEFERRED | Buffer drainPolicy on-idle variant (design doc §4.2) — deferred on top of continuous-only v1 drain behavior
FBP005 | DEFERRED | Isometric mode (design doc §3, roadmap Milestone 6, stretch) — camera projection toggle, mode-specific skin assets, depth-sorted draw order. App ships without it if not reached.
FBP006 | DONE | USER_GUIDE.md written — see _brain/USER_GUIDE.md (SES002)
FBP007 | DEFERRED | FluxBoard Web — Canva-style hosted web build, separate future variant, reuses src/core + src/floor + src/skin unchanged, only swaps the platform adapter for browser storage instead of Tauri SQL plugin. Not started; FluxBoard PC (Tauri) is primary for now.
FBP008 | DEFERRED | UI chrome for managing the app — ribbon/tabs/panels/layers/properties surfaces (Falcon raised this explicitly, wants it discussed as its own topic). Overlaps design doc §4.6 (node properties panels) and roadmap Milestone 5 (port and interaction polish — config panels, z-order controls). Deliberately held until after Milestone 3 (full node registry) so there's real per-node config (recipes, rules, capacities) to design panels against, not just source/sink. Needs its own design conversation before building: panel layout (ribbon vs. sidebar vs. tabs), docking/floating behavior, what a "layers" concept means here beyond z-order.
