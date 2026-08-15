---
name: firmware QF-61 v4.8.26
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-61-883).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.34.

Rollout: canary fleet (15 units) for 72h, then full fleet gated on pager-quiet window.
