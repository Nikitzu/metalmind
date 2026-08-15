---
name: firmware QF-73 v2.5.10
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-73-376).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.31.

Rollout: canary fleet (13 units) for 72h, then full fleet gated on pager-quiet window.
