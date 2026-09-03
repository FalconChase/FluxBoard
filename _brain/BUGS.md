# BUGS.md
# FluxBoard bug register. Project-local IDs (FBB00x). Empty at brain onboarding.
---
| ID | SEVERITY | ITEM | FOUND | STATUS |
|----|----------|------|-------|--------|
| FBB001 | LOW | Conveyor belt tick animation and 'circling' item spin kept animating while RUN/HOLD was paused — they were driven off raw wall-clock time (`performance.now()`-derived `elapsedMs`), not the sim driver's own paused/running state, so the visual kept moving even though item progress correctly froze. Found by Falcon right after Milestone 4. | SES013/Falcon | FIXED (FBF001) |
