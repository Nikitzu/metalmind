---
name: Deployment topology
type: reference
---

**Primary region:** GCP `europe-west4` (Eemshaven, Netherlands). All Dispatcher, Fleet API, and Postgres primary + replicas live here.

**DR region:** GCP `europe-west1` (St. Ghislain, Belgium). Warm standby Postgres via logical replication. RPO target 30 seconds, RTO target 15 minutes. Tested quarterly — last test 2026-03-20, passed with RTO 12:40.

**Edge controller:** runs on-drone (not in GCP). OTA updates via Dmitri's Terraform-managed rollout pipeline, staged 5% → 25% → 100% over 48 hours.

**Explicitly NOT used:** AWS (GCP-only corporate policy since 2025), `us-east1` (no US customers — see decision doc on Postgres).

Console UI deploys to Cloudflare Pages, not GCP, because the edge-cached static bundle costs €40/month vs GCP CDN's €380 at current traffic.
