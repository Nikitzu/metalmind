---
name: firmware SP-8 v3.7.20
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-8-801).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.32.

Rollout: canary fleet (5 units) for 72h, then full fleet gated on pager-quiet window.
