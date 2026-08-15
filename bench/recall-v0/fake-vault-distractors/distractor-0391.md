---
name: firmware QF-84 v4.0.3
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-84-443).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.32.

Rollout: canary fleet (19 units) for 72h, then full fleet gated on pager-quiet window.
