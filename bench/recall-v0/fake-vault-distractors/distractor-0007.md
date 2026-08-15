---
name: firmware QF-58 v2.0.1
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-58-600).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.36.

Rollout: canary fleet (8 units) for 72h, then full fleet gated on pager-quiet window.
