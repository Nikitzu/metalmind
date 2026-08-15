---
name: firmware QF-61 v3.3.18
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-61-337).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.31.

Rollout: canary fleet (18 units) for 72h, then full fleet gated on pager-quiet window.
