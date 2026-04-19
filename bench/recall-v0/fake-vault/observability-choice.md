---
name: Dropped Honeycomb for Grafana Cloud
type: decision
date: 2026-03-02
---

Migrated from Honeycomb to **Grafana Cloud** (Loki + Tempo + Mimir bundle).

**Why:**

- Honeycomb bill hit €4,200/month in February 2026 against €1,500 budget.
- Grafana Cloud Pro at our volume: €780/month.
- Team had existing Grafana expertise from the Postgres dashboards.

**Tradeoffs accepted:**

- Lose Honeycomb's BubbleUp outlier detection. Replacement plan: custom Grafana alert rules tuned per-service.
- Tempo trace retention is 30 days vs Honeycomb's 60; archive older traces to GCS.

**Migration window:** 2026-03-02 → 2026-03-16. Cutover clean, zero tracing gaps. Honeycomb contract terminated 2026-03-31 (paid through April under notice clause).

Owner: Dmitri.
