---
name: firmware SP-8 v2.2.23
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-8-369).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.34.

Rollout: canary fleet (20 units) for 72h, then full fleet gated on pager-quiet window.
