---
name: firmware QF-14 v4.8.6
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-14-421).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.37.

Rollout: canary fleet (14 units) for 72h, then full fleet gated on pager-quiet window.
