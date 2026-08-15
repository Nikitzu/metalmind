---
name: firmware QF-92 v1.3.4
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-92-696).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.34.

Rollout: canary fleet (17 units) for 72h, then full fleet gated on pager-quiet window.
