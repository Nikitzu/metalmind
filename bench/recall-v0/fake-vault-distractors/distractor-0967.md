---
name: firmware QF-73 v3.10.16
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-73-422).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.40.

Rollout: canary fleet (19 units) for 72h, then full fleet gated on pager-quiet window.
