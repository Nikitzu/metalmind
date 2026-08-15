---
name: firmware WR-11 v2.9.1
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-11-402).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.37.

Rollout: canary fleet (5 units) for 72h, then full fleet gated on pager-quiet window.
