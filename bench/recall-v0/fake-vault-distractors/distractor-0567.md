---
name: firmware QF-84 v1.9.28
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-84-621).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.34.

Rollout: canary fleet (12 units) for 72h, then full fleet gated on pager-quiet window.
