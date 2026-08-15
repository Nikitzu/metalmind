---
name: firmware SP-5 v3.5.4
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-5-476).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.37.

Rollout: canary fleet (10 units) for 72h, then full fleet gated on pager-quiet window.
