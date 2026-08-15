---
name: firmware SP-5 v3.6.10
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-5-681).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.35.

Rollout: canary fleet (19 units) for 72h, then full fleet gated on pager-quiet window.
