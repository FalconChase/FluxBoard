# FIXES.md
# FluxBoard verified solution registry. Project-local IDs (FBF00x). Empty at brain onboarding.
---
| ID | FIXES | SOLUTION | SESSION |
|----|-------|----------|---------|
| FBF001 | FBB001 | `FluxCanvas`'s render loop now keeps its own `animElapsedMs` clock, separate from the sim driver's clock and from raw wall time — it only accumulates frame-to-frame delta while `driver.isRunning()` is true, and that clock (not wall time) feeds both the conveyor belt-tick phase and the circling item rotation. RUN/HOLD now freezes every visual, not just item position. | SES014 |
| FBF002 | FBB002 | `InterpolatedSimDriver.getRenderItems()` now only blends prev/curr progress when `prev.edgeId === curr.edgeId`. If an item's edge changed between the two snapshots (forwarded mid-tick), it renders at `curr.progress` directly — same treatment as a freshly-spawned item (holds at its actual position for that frame window), instead of blending two different curves' progress values as if they were one. Added a regression test (`nodeRegistry`-style direct-numbers scenario) plus verified against the pre-fix code by compiling both versions outside vitest and comparing actual output. | SES015 |
