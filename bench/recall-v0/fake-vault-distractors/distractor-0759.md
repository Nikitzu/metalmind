---
name: firmware SP-5 v3.12.25
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-5-947).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.30.

Rollout: canary fleet (16 units) for 72h, then full fleet gated on pager-quiet window.
