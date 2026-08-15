---
name: firmware SP-8 v4.6.16
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-8-121).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.32.

Rollout: canary fleet (8 units) for 72h, then full fleet gated on pager-quiet window.
