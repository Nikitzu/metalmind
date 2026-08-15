---
name: firmware QF-22 v2.1.16
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-22-814).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.37.

Rollout: canary fleet (19 units) for 72h, then full fleet gated on pager-quiet window.
