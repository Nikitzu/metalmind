"""Unit tests for the rerank module.

Intentionally does NOT import FlagEmbedding — the module must behave
gracefully when the opt-in rerank dependency is absent. That's the whole
point of `uv tool install metalmind-vault-rag[rerank]` being optional.
"""
import sys
from unittest.mock import MagicMock

import pytest

from metalmind_vault_rag import rerank as rerank_mod


@pytest.fixture(autouse=True)
def _reset_reranker_singleton() -> None:
    """Each test gets a clean slate so failure stickiness doesn't leak."""
    rerank_mod._RERANKER = None
    rerank_mod._RERANKER_FAILED = False
    yield
    rerank_mod._RERANKER = None
    rerank_mod._RERANKER_FAILED = False


def test_overfetch_k_honors_env_default() -> None:
    # 4× default, floored at 20
    assert rerank_mod.overfetch_k(5) == 20  # 5*4=20
    assert rerank_mod.overfetch_k(10) == 40  # 10*4=40
    assert rerank_mod.overfetch_k(1) == 20  # min floor


def test_rerank_hits_returns_empty_for_empty_input() -> None:
    assert rerank_mod.rerank_hits("any query", [], k=5) == []


def test_rerank_hits_falls_back_to_embedder_order_when_model_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Simulate no FlagEmbedding installed by blocking the import.
    monkeypatch.setitem(sys.modules, "FlagEmbedding", None)
    hits = [
        {"file": "a.md", "score": 0.9, "text": "alpha"},
        {"file": "b.md", "score": 0.8, "text": "beta"},
        {"file": "c.md", "score": 0.7, "text": "gamma"},
    ]
    result = rerank_mod.rerank_hits("query", hits, k=2)
    # Top-k of original ordering, unchanged.
    assert [h["file"] for h in result] == ["a.md", "b.md"]
    assert "prev_score" not in result[0]  # not reranked, so no score rewrite


def test_rerank_hits_position_blend_protects_top_retrieval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Position-aware blend: the rank-1 retrieval hit is protected from a
    reranker that strongly disagrees. The reranker still influences ordering
    via its 25% contribution at the top, and dominates further down."""
    fake_module = MagicMock()
    fake_reranker = MagicMock()
    fake_reranker.compute_score.return_value = [0.1, 0.9, 0.5]
    fake_module.FlagReranker.return_value = fake_reranker
    monkeypatch.setitem(sys.modules, "FlagEmbedding", fake_module)

    hits = [
        {"file": "a.md", "score": 0.9, "text": "alpha"},
        {"file": "b.md", "score": 0.8, "text": "beta"},
        {"file": "c.md", "score": 0.7, "text": "gamma"},
    ]
    result = rerank_mod.rerank_hits("query", hits, k=3)
    # Each rank gets retrieval weight 0.75; position_score = 1/rank:
    # a: 0.75*1.000 + 0.25*0.1 = 0.7750
    # b: 0.75*0.500 + 0.25*0.9 = 0.6000
    # c: 0.75*0.333 + 0.25*0.5 = 0.3750
    assert [h["file"] for h in result] == ["a.md", "b.md", "c.md"]
    assert result[0]["prev_score"] == 0.9
    assert result[0]["score"] == 0.775
    assert result[1]["score"] == 0.6
    assert result[2]["score"] == 0.375


def test_rerank_hits_position_blend_lower_ranks_defer_to_reranker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Below rank 10, retrieval weight drops to 0.40 so the reranker drives
    ordering for hits the retriever was unsure about. A strong rerank score
    at rank 11 should outrank ranks 2-10 with weak rerank scores."""
    fake_module = MagicMock()
    fake_reranker = MagicMock()
    rerank_scores = [0.0] * 10 + [0.95]
    fake_reranker.compute_score.return_value = rerank_scores
    fake_module.FlagReranker.return_value = fake_reranker
    monkeypatch.setitem(sys.modules, "FlagEmbedding", fake_module)

    hits = [{"file": f"f{i}.md", "score": 0.5, "text": f"t{i}"} for i in range(11)]
    result = rerank_mod.rerank_hits("query", hits, k=11)
    # Rank 11 blended: 0.40 * (1/11) + 0.60 * 0.95 ≈ 0.6064
    # Rank 1 blended:  0.75 * 1.000 + 0.25 * 0.0  = 0.75
    # Rank 11 leapfrogs ranks 2-10, which all have rerank score 0.0.
    assert result[0]["file"] == "f0.md"
    assert result[1]["file"] == "f10.md"


def test_load_failure_is_sticky_no_retry_spam(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After one failed load, subsequent calls must not re-attempt (avoids
    thrashing stderr on every recall when the dep is legitimately missing)."""
    monkeypatch.setitem(sys.modules, "FlagEmbedding", None)
    first = rerank_mod._load_reranker()
    second = rerank_mod._load_reranker()
    assert first is None
    assert second is None
    assert rerank_mod._RERANKER_FAILED is True
