---
name: firmware QF-58 v3.5.10
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-58-846).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.32.

Rollout: canary fleet (14 units) for 72h, then full fleet gated on pager-quiet window.
