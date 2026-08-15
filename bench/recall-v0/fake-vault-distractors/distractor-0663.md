---
name: firmware QF-22 v2.1.13
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-22-356).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.38.

Rollout: canary fleet (20 units) for 72h, then full fleet gated on pager-quiet window.
