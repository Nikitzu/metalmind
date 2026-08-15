---
name: firmware QF-58 v2.2.25
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-58-559).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.31.

Rollout: canary fleet (20 units) for 72h, then full fleet gated on pager-quiet window.
