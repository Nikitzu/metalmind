---
name: firmware QF-92 v4.3.8
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-92-655).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.38.

Rollout: canary fleet (20 units) for 72h, then full fleet gated on pager-quiet window.
