---
name: firmware SP-5 v1.1.24
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-5-177).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.34.

Rollout: canary fleet (9 units) for 72h, then full fleet gated on pager-quiet window.
