"""Protocol-contract tests for EmbeddingBackend implementations.

Mocked at the IO boundary so the suite is hermetic: a fake
TextEmbedding stands in for FastEmbedBackend's ONNX model, so no model
downloads in CI. The fake produces deterministic one-hot vectors so we
can assert input order is preserved across batches.

The parametrize survives the removal of OllamaBackend in v0.16.0 so the
next backend costs one line.
"""

from __future__ import annotations

import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from metalmind_vault_rag.backends import make_backend
from metalmind_vault_rag.backends.fastembed_backend import DEFAULT_MODEL, FastEmbedBackend


# -----------------------------------------------------------------------------
# Fakes
# -----------------------------------------------------------------------------


class _FakeTextEmbedding:
    """fastembed-shaped fake. Yields deterministic one-hot vectors."""

    def __init__(self, model_name: str, dim: int = 4) -> None:
        self.model_name = model_name
        self._dim = dim

    def embed(self, texts):  # noqa: ANN001
        for idx, _t in enumerate(texts):
            yield [1.0 if i == idx % self._dim else 0.0 for i in range(self._dim)]


# -----------------------------------------------------------------------------
# Fixtures: parametric per-backend
# -----------------------------------------------------------------------------


@pytest.fixture(params=["fastembed"])
def backend(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    # stub the import so .embed() never reaches the real ONNX runtime.
    fake_module = SimpleNamespace(
        TextEmbedding=lambda model_name, cache_dir=None: _FakeTextEmbedding(model_name, dim=4)
    )
    monkeypatch.setitem(sys.modules, "fastembed", fake_module)
    yield FastEmbedBackend(model_name="fake-model", dim=4)


# -----------------------------------------------------------------------------
# Contract tests run against every backend
# -----------------------------------------------------------------------------


def test_embed_empty_input_returns_empty(backend) -> None:
    assert backend.embed([]) == []


def test_embed_returns_one_vector_per_input(backend) -> None:
    out = backend.embed(["a", "b", "c"])
    assert len(out) == 3
    assert all(len(v) == 4 for v in out)


def test_embed_preserves_input_order(backend) -> None:
    out = backend.embed(["a", "b", "c"])
    assert out[0] == [1.0, 0.0, 0.0, 0.0]
    assert out[1] == [0.0, 1.0, 0.0, 0.0]
    assert out[2] == [0.0, 0.0, 1.0, 0.0]


def test_dimension_is_stable(backend) -> None:
    assert backend.dimension() == 4
    assert backend.dimension() == 4


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------


def test_make_backend_legacy_explains_the_removal(monkeypatch: pytest.MonkeyPatch) -> None:
    """A stale METALMIND_BACKEND=legacy export must fail loudly. Silently
    falling through to fastembed would re-embed the vault with a different
    model than the index was built with."""
    monkeypatch.setenv("METALMIND_BACKEND", "legacy")
    with pytest.raises(ValueError, match="removed in v0.16.0"):
        make_backend()


def test_make_backend_embedded_returns_fastembed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METALMIND_BACKEND", "embedded")
    instance = make_backend()
    assert isinstance(instance, FastEmbedBackend)


def test_make_backend_rejects_unknown_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METALMIND_BACKEND", "nonsense")
    with pytest.raises(ValueError, match="unknown METALMIND_BACKEND"):
        make_backend()


def test_cache_dir_defaults_to_metalmind_home(monkeypatch: pytest.MonkeyPatch) -> None:
    """Model cache must live under ~/.metalmind, not the system temp dir -
    macOS purges temp files, leaving a broken half-cache (NO_SUCHFILE)."""
    from metalmind_vault_rag.backends.fastembed_backend import resolve_cache_dir

    monkeypatch.delenv("FASTEMBED_CACHE_PATH", raising=False)
    monkeypatch.setenv("HOME", "/home/tester")
    assert resolve_cache_dir() == "/home/tester/.metalmind/cache/fastembed"


def test_cache_dir_env_override_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    from metalmind_vault_rag.backends.fastembed_backend import resolve_cache_dir

    monkeypatch.setenv("FASTEMBED_CACHE_PATH", "/custom/cache")
    assert resolve_cache_dir() == "/custom/cache"


def test_model_id_reports_the_configured_model(backend) -> None:
    assert backend.model_id() == "fake-model"


def test_model_id_falls_back_to_the_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VAULT_EMBED_MODEL", raising=False)

    assert FastEmbedBackend().model_id() == DEFAULT_MODEL


def test_model_id_follows_the_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VAULT_EMBED_MODEL", "BAAI/bge-base-en-v1.5")

    assert FastEmbedBackend().model_id() == "BAAI/bge-base-en-v1.5"
