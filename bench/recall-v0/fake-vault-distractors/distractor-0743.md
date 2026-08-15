---
name: firmware WR-11 v1.4.26
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-11-126).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.33.

Rollout: canary fleet (12 units) for 72h, then full fleet gated on pager-quiet window.
