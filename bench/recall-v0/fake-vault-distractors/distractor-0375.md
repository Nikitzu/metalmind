---
name: firmware QF-47 v1.5.25
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-47-614).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.40.

Rollout: canary fleet (7 units) for 72h, then full fleet gated on pager-quiet window.
