---
name: firmware WR-11 v2.1.0
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-11-918).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.33.

Rollout: canary fleet (11 units) for 72h, then full fleet gated on pager-quiet window.
