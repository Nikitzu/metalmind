"""Canary for the rerank dependency stack.

Runs only when the `[rerank]` extra is installed — skipped on the default
dev install. Its job is to fail loudly when a future bump to `transformers`
breaks the FlagEmbedding integration the way it broke in v0.3.0.

History (v0.3.0): `transformers` 5.x removed
`XLMRobertaTokenizer.prepare_for_model`, which FlagEmbedding 1.3's
reranker calls. The reranker construction succeeded, scoring raised
`AttributeError`, the calling code logged WARN and silently returned the
unreranked top-K. Every `--rerank` call returned embedder ordering. We
caught it via the bench (rerank-on and rerank-off produced byte-identical
hit@K), then pinned `transformers<5` in the `[rerank]` extra.

This test fires that compatibility check at import time so future drift
gets caught in CI before reaching users.
"""

from __future__ import annotations

import importlib.util

import pytest


_RERANK_NOT_INSTALLED = importlib.util.find_spec("FlagEmbedding") is None


@pytest.mark.skipif(
    _RERANK_NOT_INSTALLED,
    reason="[rerank] extra not installed — canary skipped on default dev install",
)
def test_flagembedding_imports_cleanly() -> None:
    from FlagEmbedding import FlagReranker  # noqa: F401


@pytest.mark.skipif(
    _RERANK_NOT_INSTALLED,
    reason="[rerank] extra not installed — canary skipped on default dev install",
)
def test_xlm_roberta_tokenizer_has_prepare_for_model() -> None:
    """Pin guard: FlagEmbedding 1.3's reranker calls
    `XLMRobertaTokenizer.prepare_for_model`. Removed in transformers 5.0.
    Asserting `hasattr` keeps the [rerank] extra honest about its
    transformers ceiling — bump pyproject's pin if this fails.
    """
    from transformers import XLMRobertaTokenizer

    assert hasattr(XLMRobertaTokenizer, "prepare_for_model"), (
        "transformers >= 5 detected. FlagEmbedding 1.3's reranker calls "
        "XLMRobertaTokenizer.prepare_for_model which was removed in "
        "transformers 5. The `[rerank]` extra in pyproject.toml needs to "
        "keep `transformers<5` — see the v0.3.0 silent-fallback fix."
    )
