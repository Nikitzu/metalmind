---
name: firmware QF-58 v4.1.25
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-58-271).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.35.

Rollout: canary fleet (9 units) for 72h, then full fleet gated on pager-quiet window.
