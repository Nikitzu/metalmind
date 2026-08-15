---
name: firmware WR-03 v2.5.19
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-03-745).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.35.

Rollout: canary fleet (5 units) for 72h, then full fleet gated on pager-quiet window.
