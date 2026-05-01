"""Unit tests for the rerank module (ONNX path, v0.5.2+).

Intentionally does NOT import the optional ONNX deps (`onnxruntime`,
`tokenizers`, `huggingface_hub`) — the module must behave gracefully
when the `[rerank]` extra is absent. That's the whole point of
`uv tool install metalmind-vault-rag[rerank]` being optional.
"""
import sys
from unittest.mock import MagicMock

import pytest

from metalmind_vault_rag import rerank as rerank_mod


@pytest.fixture(autouse=True)
def _reset_reranker_singleton() -> None:
    """Each test gets a clean slate so failure stickiness doesn't leak."""
    rerank_mod._SESSION = None
    rerank_mod._TOKENIZER = None
    rerank_mod._FAILED = False
    yield
    rerank_mod._SESSION = None
    rerank_mod._TOKENIZER = None
    rerank_mod._FAILED = False


def test_overfetch_k_honors_env_default() -> None:
    # 4× default, floored at 20
    assert rerank_mod.overfetch_k(5) == 20  # 5*4=20
    assert rerank_mod.overfetch_k(10) == 40  # 10*4=40
    assert rerank_mod.overfetch_k(1) == 20  # min floor


def test_rerank_hits_returns_empty_for_empty_input() -> None:
    assert rerank_mod.rerank_hits("any query", [], k=5) == []


def test_rerank_hits_falls_back_to_embedder_order_when_deps_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Simulate the ONNX deps being unavailable.
    monkeypatch.setitem(sys.modules, "onnxruntime", None)
    monkeypatch.setitem(sys.modules, "tokenizers", None)
    monkeypatch.setitem(sys.modules, "huggingface_hub", None)
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
    """rerank_hits hands ordering to the cross-encoder. Inject a fake
    session+tokenizer and prove resort happens with deliberately inverted
    scores. _score_batch is the integration boundary; mock that."""
    fake_session = MagicMock()
    fake_tokenizer = MagicMock()
    monkeypatch.setattr(rerank_mod, "_SESSION", fake_session, raising=False)
    monkeypatch.setattr(rerank_mod, "_TOKENIZER", fake_tokenizer, raising=False)
    monkeypatch.setattr(
        rerank_mod, "_score_batch", lambda session, tokenizer, pairs: [0.1, 0.9, 0.5]
    )

    hits = [
        {"file": "a.md", "score": 0.9, "text": "alpha"},
        {"file": "b.md", "score": 0.8, "text": "beta"},
        {"file": "c.md", "score": 0.7, "text": "gamma"},
    ]
    result = rerank_mod.rerank_hits("query", hits, k=2)
    assert [h["file"] for h in result] == ["b.md", "c.md"]
    assert result[0]["prev_score"] == 0.8
    assert result[0]["score"] == 0.9
    assert result[1]["prev_score"] == 0.7
    assert result[1]["score"] == 0.5


def test_load_failure_is_sticky_no_retry_spam(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After one failed load, subsequent calls must not re-attempt (avoids
    thrashing stderr on every recall when deps are legitimately missing)."""
    monkeypatch.setitem(sys.modules, "onnxruntime", None)
    first = rerank_mod._load()
    second = rerank_mod._load()
    assert first is None
    assert second is None
    assert rerank_mod._FAILED is True


def test_sigmoid_is_numerically_stable() -> None:
    """The hand-rolled sigmoid avoids overflow on large negative inputs.
    A naive 1/(1+exp(-x)) overflows for x < ~-700; ours splits the case."""
    assert 0.0 <= rerank_mod._sigmoid(-1000.0) < 1e-300 or rerank_mod._sigmoid(-1000.0) == 0.0
    assert rerank_mod._sigmoid(1000.0) == pytest.approx(1.0)
    assert rerank_mod._sigmoid(0.0) == pytest.approx(0.5)
