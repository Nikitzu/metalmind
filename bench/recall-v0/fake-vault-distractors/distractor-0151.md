---
name: firmware SP-5 v2.3.19
type: firmware
---

Changes:
- Fix drift in IMU calibration after thermal cycles (tracked as SP-5-672).
- Reduce OTA download time by batching telemetry flush.
- Bump tokio to 1.33.

Rollout: canary fleet (19 units) for 72h, then full fleet gated on pager-quiet window.
