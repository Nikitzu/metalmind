"""Per-vault confidence bands.

RRF fuses by rank position and discards score magnitude, so a fused top score
is roughly the same whether the hit is a bullseye or the least-bad of a bad
set. Measured against held-out unanswerable questions, fused scores separate
answerable from unanswerable at AUC 0.549, a coin flip. Raw embedder cosine
reaches 0.984 on a real vault.

The threshold that exploits cosine cannot ship as a constant. Cosine
distributions are shaped by the genre of the text being indexed: the same
signal that separates cleanly on prose notes reaches only 0.771 on chat
transcripts, with no usable threshold at all. So the edges are derived from
whatever vault is in front of the tool.

Two edges, neither of which needs labelled data:

- The **low edge** is the 10th percentile of scores from excerpt queries built
  out of the vault's own indexed chunks. p10 is not arbitrary. Measured against
  hand-authored natural questions on the same vault, the excerpt protocol's p10
  came out at 0.6952 against 0.6983, a delta of 0.003; at p5 the delta is 0.018
  and at p20 it is 0.012. The whole approach rests on excerpt queries standing
  in for real ones, so the edge belongs where that substitution is most
  faithful.
- The **high edge** is the 95th percentile of scores from shipped probe
  queries, which are unanswerable by construction. p95 rather than p90 halves
  false high-confidence on blanks (11% to 6%) at no cost to real answers,
  because raising this edge only moves negatives out of the middle band.

`MIN_POSITIVE_SAMPLES` is 50 because below that a p10 estimate is noise. A
vault that small is also one whose owner can read all of it, so the signal
would earn little there anyway.

This module holds the arithmetic and the sidecar format. Sampling and the
indexer hook live in their own places.
"""

from __future__ import annotations

import json
import os
import pathlib
from dataclasses import dataclass
from datetime import datetime, timezone

SIDECAR_VERSION = 1

LOW_EDGE_PERCENTILE = float(os.environ.get("METALMIND_CONFIDENCE_LOW_PCT", "10"))
HIGH_EDGE_PERCENTILE = float(os.environ.get("METALMIND_CONFIDENCE_HIGH_PCT", "95"))

MIN_POSITIVE_SAMPLES = 50

OUT_OF_DOMAIN_COUNT = 67
NEAR_MISS_COUNT = 33

NEAR_MISS_HIGH_TOLERANCE = 0.5

_PROBES_PATH = pathlib.Path(__file__).with_name("probes.json")
_PROBES: dict[str, list[str]] | None = None


def _probe_fixture() -> dict[str, list[str]]:
    global _PROBES
    if _PROBES is None:
        payload = json.loads(_PROBES_PATH.read_text(encoding="utf-8"))
        _PROBES = {
            "out_of_domain": list(payload["out_of_domain"]),
            "near_miss": list(payload["near_miss"]),
        }
    return _PROBES


def load_probes() -> list[str]:
    """Out-of-domain probes, which derive the high edge.

    Handed out as a copy so a caller cannot corrupt the fixture for the rest of
    the process."""
    return list(_probe_fixture()["out_of_domain"])


def load_near_miss() -> list[str]:
    """Probes deliberately close to knowledge-work subject matter, held out of
    edge derivation.

    Measured on a real vault, these score a full 0.07 higher at p95 than the
    out-of-domain set, because embeddings key on words like dashboard, deploy
    and migration while an invented proper noun barely moves them. Including
    them in the derivation pushed the high edge up into the answerable
    distribution and the classes stopped separating. They are unanswerable all
    the same, which makes them the right instrument for a different job:
    checking that the derived band is not over-confident."""
    return list(_probe_fixture()["near_miss"])


@dataclass(frozen=True)
class Bands:
    """Confidence edges for one collection. `high_edge` is the ceiling of the
    unanswerable distribution and `low_edge` the floor of the answerable one,
    so a valid pair always has `high_edge < low_edge`."""

    low_edge: float
    high_edge: float


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank percentile. Sorts defensively; callers pass raw score
    lists."""
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = round((p / 100) * (len(ordered) - 1))
    return ordered[max(0, min(len(ordered) - 1, int(idx)))]


def derive_bands(
    positive_scores: list[float],
    probe_scores: list[float],
    near_miss_scores: list[float] | None = None,
) -> Bands | None:
    """Edges from the score distributions, or None when this vault does not
    support a confidence signal.

    Refusing is a real outcome, not an error. A vault too small to sample, or
    one where the probes score as highly as the vault's own content, cannot
    support a threshold, and reporting no confidence is better than reporting a
    wrong one.

    `near_miss_scores` are held-out unanswerable questions close to the vault's
    subject matter. Any that land in the `high` band are cases where the tool
    would claim confidence about content it does not hold, so too many of them
    means the band is over-confident and no band is reported at all. Measured
    on a real vault the rate is 21%, well inside the tolerance; the guard is
    there to catch a vault where it is not."""
    if len(positive_scores) < MIN_POSITIVE_SAMPLES or not probe_scores:
        return None

    low_edge = percentile(positive_scores, LOW_EDGE_PERCENTILE)
    high_edge = percentile(probe_scores, HIGH_EDGE_PERCENTILE)
    if high_edge >= low_edge:
        return None

    if near_miss_scores:
        over = sum(1 for s in near_miss_scores if s >= low_edge)
        if over / len(near_miss_scores) >= NEAR_MISS_HIGH_TOLERANCE:
            return None

    return Bands(low_edge=low_edge, high_edge=high_edge)


def classify(score: float | None, bands: Bands) -> str:
    """Band for the best cosine seen among a result set's hits."""
    if score is None or score < bands.high_edge:
        return "low"
    if score >= bands.low_edge:
        return "high"
    return "medium"


def embedder_id(model: str, dimension: int) -> str:
    """Identity of the model that produced the scores an edge was derived from.
    Cosine distributions move with the model, so edges derived under one are
    meaningless under another."""
    return f"{model}@{dimension}"


def sidecar_path(collection: str) -> pathlib.Path:
    """Beside the index databases, not inside them. Keeping calibration out of
    the index schema means shipping it never forces a reindex."""
    return pathlib.Path.home() / ".metalmind" / f"{collection}.calibration.json"


def write_sidecar(
    path: pathlib.Path,
    bands: Bands,
    embedder: str,
    positives_n: int,
    probes_n: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": SIDECAR_VERSION,
        "low_edge": bands.low_edge,
        "high_edge": bands.high_edge,
        "embedder": embedder,
        "positives_n": positives_n,
        "probes_n": probes_n,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_sidecar(path: pathlib.Path, embedder: str) -> Bands | None:
    """Bands for this collection, or None if there are none to be had.

    Every failure returns None rather than raising. A missing or stale sidecar
    means the caller reports no confidence, which is the same behaviour as a
    vault that has never been calibrated."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if payload.get("version") != SIDECAR_VERSION:
        return None
    if payload.get("embedder") != embedder:
        return None
    try:
        return Bands(low_edge=float(payload["low_edge"]), high_edge=float(payload["high_edge"]))
    except (KeyError, TypeError, ValueError):
        return None
