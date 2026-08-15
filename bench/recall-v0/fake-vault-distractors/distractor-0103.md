---
name: firmware QF-47 v3.11.20
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-47-586).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.39.

Rollout: canary fleet (14 units) for 72h, then full fleet gated on pager-quiet window.
