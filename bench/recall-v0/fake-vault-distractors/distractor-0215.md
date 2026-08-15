---
name: firmware QF-47 v4.5.15
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-47-971).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.38.

Rollout: canary fleet (14 units) for 72h, then full fleet gated on pager-quiet window.
