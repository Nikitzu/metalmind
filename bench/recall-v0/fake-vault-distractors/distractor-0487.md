---
name: firmware QF-61 v1.7.21
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-61-896).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.30.

Rollout: canary fleet (12 units) for 72h, then full fleet gated on pager-quiet window.
