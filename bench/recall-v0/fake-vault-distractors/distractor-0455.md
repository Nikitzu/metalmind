---
name: firmware SP-8 v1.9.15
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-8-579).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.36.

Rollout: canary fleet (14 units) for 72h, then full fleet gated on pager-quiet window.
