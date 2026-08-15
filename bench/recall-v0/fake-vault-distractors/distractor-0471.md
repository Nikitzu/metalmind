---
name: firmware WR-11 v3.5.25
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-11-775).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.31.

Rollout: canary fleet (13 units) for 72h, then full fleet gated on pager-quiet window.
