---
name: firmware SP-8 v1.6.21
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-8-733).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.40.

Rollout: canary fleet (13 units) for 72h, then full fleet gated on pager-quiet window.
