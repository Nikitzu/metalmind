---
name: firmware SP-5 v2.2.1
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-5-555).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.36.

Rollout: canary fleet (9 units) for 72h, then full fleet gated on pager-quiet window.
