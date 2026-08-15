---
name: firmware WR-11 v3.7.28
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-11-880).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.37.

Rollout: canary fleet (7 units) for 72h, then full fleet gated on pager-quiet window.
