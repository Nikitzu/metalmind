---
name: firmware QF-92 v2.1.15
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-92-912).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.40.

Rollout: canary fleet (18 units) for 72h, then full fleet gated on pager-quiet window.
