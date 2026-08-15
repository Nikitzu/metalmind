---
name: firmware QF-73 v3.2.30
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as QF-73-846).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.33.

Rollout: canary fleet (8 units) for 72h, then full fleet gated on pager-quiet window.
