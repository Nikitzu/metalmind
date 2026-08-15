---
name: firmware SP-8 v1.5.17
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-8-923).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.37.

Rollout: canary fleet (11 units) for 72h, then full fleet gated on pager-quiet window.
