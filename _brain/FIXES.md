# FIXES.md
# FluxBoard verified solution registry. Project-local IDs (FBF00x). Empty at brain onboarding.
---
| ID | FIXES | SOLUTION | SESSION |
|----|-------|----------|---------|
| FBF001 | FBB001 | `FluxCanvas`'s render loop now keeps its own `animElapsedMs` clock, separate from the sim driver's clock and from raw wall time — it only accumulates frame-to-frame delta while `driver.isRunning()` is true, and that clock (not wall time) feeds both the conveyor belt-tick phase and the circling item rotation. RUN/HOLD now freezes every visual, not just item position. | SES014 |
