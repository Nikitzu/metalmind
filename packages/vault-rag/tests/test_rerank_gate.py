"""The gate that decides a query does not need the cross-encoder.

Reranking costs roughly a thousand times what the rest of the query costs, and
on the adversarial bench it leaves three quarters of results untouched. The
gate spends that only where fusion left the top two close together.
"""
from __future__ import annotations

import importlib

import pytest

from metalmind_vault_rag import search


def hits(*scores: float) -> list[dict]:
    return [{"file": f"n{i}.md", "score": s} for i, s in enumerate(scores)]


def reload_with_gate(monkeypatch: pytest.MonkeyPatch, value: str):
    monkeypatch.setenv("METALMIND_RERANK_GATE", value)
    return importlib.reload(search)


@pytest.fixture(autouse=True)
def restore_module():
    yield
    importlib.reload(search)


def test_gate_is_off_by_default() -> None:
    assert search.RERANK_GATE == 0.0


def test_off_never_skips_even_a_runaway_leader(monkeypatch: pytest.MonkeyPatch) -> None:
    """Zero has to mean the pre-gate path exactly, including the single-hit
    case, where reranking cannot reorder anything but still rewrites scores."""
    mod = reload_with_gate(monkeypatch, "0")
    assert mod._fusion_is_decisive(hits(1.0, 0.001)) is False
    assert mod._fusion_is_decisive(hits(1.0)) is False
    assert mod._fusion_is_decisive([]) is False


def test_a_clear_leader_skips_the_cross_encoder(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = reload_with_gate(monkeypatch, "0.25")
    assert mod._fusion_is_decisive(hits(0.10, 0.05)) is True


def test_a_near_tie_still_pays_for_reranking(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = reload_with_gate(monkeypatch, "0.25")
    assert mod._fusion_is_decisive(hits(0.10, 0.095)) is False


def test_gap_is_measured_relatively_not_absolutely(monkeypatch: pytest.MonkeyPatch) -> None:
    """RRF sums are small and their scale moves with how many retrievers found
    a document, so an absolute gap would gate differently on the same ranking
    depending on fusion arithmetic that carries no meaning of its own."""
    mod = reload_with_gate(monkeypatch, "0.25")
    assert mod._fusion_is_decisive(hits(1.0, 0.5)) is True
    assert mod._fusion_is_decisive(hits(0.001, 0.0005)) is True


def test_a_reordered_list_can_show_a_negative_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    """Date ordering and supersede promotion move hits without touching the
    score, so position one does not always hold the highest score. That is not
    decisive by any reading."""
    mod = reload_with_gate(monkeypatch, "0.25")
    assert mod._fusion_is_decisive(hits(0.05, 0.10)) is False


def test_a_zero_top_score_is_not_decisive(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = reload_with_gate(monkeypatch, "0.25")
    assert mod._fusion_is_decisive(hits(0.0, 0.0)) is False


def test_threshold_is_clamped_to_a_usable_range(monkeypatch: pytest.MonkeyPatch) -> None:
    """A gate above 1.0 could never fire, since the gap is a fraction of the
    top score, and a negative one would skip everything."""
    assert reload_with_gate(monkeypatch, "5").RERANK_GATE == 1.0
    assert reload_with_gate(monkeypatch, "-1").RERANK_GATE == 0.0
