"""Canary for the rerank dependency stack (ONNX path, v0.5.2+).

Runs only when the `[rerank]` extra is installed - skipped on the default
dev install. Its job is to fail loudly if the ONNX runtime stack breaks
the way the FlagEmbedding/transformers stack broke in v0.3.0.

History:
- v0.3.0 caught a transformers 5.x compat bug (FlagEmbedding called a
  removed `XLMRobertaTokenizer.prepare_for_model`). We pinned `transformers<5`.
- v0.5.2 dropped FlagEmbedding + transformers + torch entirely (~2 GB)
  for `onnxruntime` + `tokenizers` + `huggingface_hub` (~60 MB). Same
  model (BAAI's bge-reranker-v2-m3) via the Xenova ONNX export.

This test fires the compat check at import time so future drift gets
caught in CI before reaching users.
"""

from __future__ import annotations

import importlib.util

import pytest

from metalmind_vault_rag import rerank


_RERANK_NOT_INSTALLED = not rerank.is_dep_available()
_SKIP_REASON = "[rerank] extra not installed - canary skipped on default dev install"


@pytest.mark.skipif(_RERANK_NOT_INSTALLED, reason=_SKIP_REASON)
def test_onnxruntime_imports_cleanly() -> None:
    import onnxruntime  # noqa: F401


@pytest.mark.skipif(_RERANK_NOT_INSTALLED, reason=_SKIP_REASON)
def test_tokenizers_imports_cleanly() -> None:
    from tokenizers import Tokenizer  # noqa: F401


@pytest.mark.skipif(_RERANK_NOT_INSTALLED, reason=_SKIP_REASON)
def test_huggingface_hub_has_hf_hub_download() -> None:
    """Guard: the ONNX path uses `huggingface_hub.hf_hub_download` to
    fetch model + tokenizer. If hub deprecates the symbol, rerank silently
    breaks; this asserts the import succeeds."""
    from huggingface_hub import hf_hub_download  # noqa: F401


@pytest.mark.skipif(_RERANK_NOT_INSTALLED, reason=_SKIP_REASON)
def test_no_torch_in_rerank_extra() -> None:
    """The whole point of v0.5.2 was dropping torch. If torch creeps back
    into the [rerank] extra (transitive dep regression, accidental import
    in a future module), the install size balloons by ~2 GB. Assert it
    isn't importable in the same process."""
    import importlib.util

    assert importlib.util.find_spec("torch") is None, (
        "torch is importable in a process where only [rerank] should be "
        "installed. Something pulled it back in - check pyproject.toml's "
        "rerank extra and any new transitive deps."
    )


def test_rerank_hits_falls_back_when_deps_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without ONNX deps, rerank_hits must return the original ordering
    truncated to k. Recall must never fail because rerank failed."""
    monkeypatch.setattr(rerank, "_FAILED", True, raising=False)
    monkeypatch.setattr(rerank, "_SESSION", None, raising=False)
    monkeypatch.setattr(rerank, "_TOKENIZER", None, raising=False)
    hits = [{"text": f"doc {i}", "score": 1.0 - i * 0.1, "file": f"f{i}.md"} for i in range(5)]
    out = rerank.rerank_hits("query", hits, k=3)
    assert [h["file"] for h in out] == ["f0.md", "f1.md", "f2.md"]


def test_overfetch_k_floor() -> None:
    """The overfetch helper guarantees a sensible floor regardless of k."""
    assert rerank.overfetch_k(1) >= 20
    assert rerank.overfetch_k(5) >= 20
    assert rerank.overfetch_k(10) >= 40
