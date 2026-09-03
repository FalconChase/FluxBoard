# BUGS.md
# FluxBoard bug register. Project-local IDs (FBB00x). Empty at brain onboarding.
---
| ID | SEVERITY | ITEM | FOUND | STATUS |
|----|----------|------|-------|--------|
| FBB001 | LOW | Conveyor belt tick animation and 'circling' item spin kept animating while RUN/HOLD was paused — they were driven off raw wall-clock time (`performance.now()`-derived `elapsedMs`), not the sim driver's own paused/running state, so the visual kept moving even though item progress correctly froze. Found by Falcon right after Milestone 4. | SES013/Falcon | FIXED (FBF001) |
| FBB002 | MEDIUM | Items visibly "bounced back" on some paths: an item forwarded onto a new edge within the same tick it arrived (distributor/sorter routing — same item id, edgeId changes, progress resets to 0) had its old edge's near-1 progress blended against its new edge's 0 progress and plotted along the NEW edge's curve — it rendered at ~80% along the new edge right after the tick, then visibly crawled backward to the edge's start as the interpolation window advanced. Reported by Falcon, confirmed by direct execution (compiled + ran outside vitest, since `npm test` isn't runnable from the bridge) with concrete numbers: old code rendered progress 0.8 -> 0.4 -> 0 across the window; should hold near 0 throughout. | SES015/Falcon | FIXED (FBF002) |
