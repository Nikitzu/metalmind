---
name: firmware WR-03 v3.12.23
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-03-577).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.31.

Rollout: canary fleet (5 units) for 72h, then full fleet gated on pager-quiet window.
