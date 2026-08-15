---
name: firmware SP-8 v2.7.10
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-8-534).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.38.

Rollout: canary fleet (16 units) for 72h, then full fleet gated on pager-quiet window.
