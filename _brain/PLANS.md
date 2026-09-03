# PLANS.md
# FluxBoard backlog — deferred builds and features not yet in active scope.
# Promotion to TEMPORARIES.md/FLUXBOARD.md STATE requires explicit Falcon instruction.
---
FBP001 | DEFERRED | Open property bag for items (beyond flat type tag, design doc §4.7) — deferred until the mixer's recipe matcher is actually being built (Milestone 3+)
FBP002 | DEFERRED | Manual z-order vs. automatic isometric depth-sort reconciliation (design doc §3, §4.5) — proposed answer: manual z-order as tie-breaker on top of auto depth-sort; not needed until the iso milestone (6)
FBP003 | DEFERRED | Edge-gated "no viable output" fallback (design doc §7) — proposed to reuse the sorter's unmatchedPolicy machinery; not yet implemented/verified
FBP004 | DEFERRED | Buffer drainPolicy on-idle variant (design doc §4.2) — deferred on top of continuous-only v1 drain behavior
FBP005 | DEFERRED | Isometric mode (design doc §3, roadmap Milestone 6, stretch) — camera projection toggle, mode-specific skin assets, depth-sorted draw order. App ships without it if not reached.
FBP006 | DONE | USER_GUIDE.md written — see _brain/USER_GUIDE.md (SES002)
FBP007 | DEFERRED | Canva-style hosted web build — separate future variant, reuses src/core + src/floor + src/skin unchanged, only swaps the platform adapter for browser storage instead of Tauri SQL plugin. Not started; desktop (Tauri) build is primary for now.
