---
name: firmware WR-03 v2.7.2
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-03-209).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.37.

Rollout: canary fleet (7 units) for 72h, then full fleet gated on pager-quiet window.
