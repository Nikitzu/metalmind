---
name: firmware QF-61 v1.9.20
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-61-646).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.35.

Rollout: canary fleet (11 units) for 72h, then full fleet gated on pager-quiet window.
