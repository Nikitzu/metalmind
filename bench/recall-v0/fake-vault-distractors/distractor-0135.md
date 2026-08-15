---
name: firmware QF-61 v2.5.22
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-61-172).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.36.

Rollout: canary fleet (15 units) for 72h, then full fleet gated on pager-quiet window.
