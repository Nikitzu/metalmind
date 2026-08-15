---
name: firmware WR-03 v3.3.20
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as WR-03-448).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.34.

Rollout: canary fleet (7 units) for 72h, then full fleet gated on pager-quiet window.
