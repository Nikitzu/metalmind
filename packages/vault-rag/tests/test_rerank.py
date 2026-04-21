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


def test_rerank_hits_resorts_by_cross_encoder_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Fake FlagReranker that returns scores in a deliberately inverted order
    # vs the embedder, so we can prove rerank_hits re-sorts.
    fake_module = MagicMock()
    fake_reranker = MagicMock()
    fake_reranker.compute_score.return_value = [0.1, 0.9, 0.5]
    fake_module.FlagReranker.return_value = fake_reranker
    monkeypatch.setitem(sys.modules, "FlagEmbedding", fake_module)

    hits = [
        {"file": "a.md", "score": 0.9, "text": "alpha"},  # embedder #1 → reranker last
        {"file": "b.md", "score": 0.8, "text": "beta"},   # embedder #2 → reranker first
        {"file": "c.md", "score": 0.7, "text": "gamma"},  # embedder #3 → reranker middle
    ]
    result = rerank_mod.rerank_hits("query", hits, k=2)
    assert [h["file"] for h in result] == ["b.md", "c.md"]
    # score replaced with rerank score; prev_score keeps original.
    assert result[0]["prev_score"] == 0.8
    assert result[0]["score"] == 0.9
    assert result[1]["prev_score"] == 0.7
    assert result[1]["score"] == 0.5


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
