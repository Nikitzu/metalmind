---
name: firmware QF-92 v1.1.17
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-92-978).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.33.

Rollout: canary fleet (8 units) for 72h, then full fleet gated on pager-quiet window.
