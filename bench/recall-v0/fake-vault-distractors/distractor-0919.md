---
name: firmware QF-14 v3.4.26
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-14-203).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.39.

Rollout: canary fleet (11 units) for 72h, then full fleet gated on pager-quiet window.
