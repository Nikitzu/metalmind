---
name: firmware QF-47 v2.1.9
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-47-877).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.34.

Rollout: canary fleet (16 units) for 72h, then full fleet gated on pager-quiet window.
