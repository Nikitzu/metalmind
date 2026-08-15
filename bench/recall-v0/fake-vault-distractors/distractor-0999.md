---
name: firmware WR-03 v1.11.14
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-03-473).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.38.

Rollout: canary fleet (10 units) for 72h, then full fleet gated on pager-quiet window.
