---
name: firmware QF-47 v3.3.17
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-47-110).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.32.

Rollout: canary fleet (11 units) for 72h, then full fleet gated on pager-quiet window.
