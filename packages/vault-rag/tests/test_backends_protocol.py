"""Protocol-contract tests for EmbeddingBackend implementations.

Both backends mocked at the IO boundary so the suite is hermetic:
- OllamaBackend: httpx.MockTransport stands in for the daemon.
- FastEmbedBackend: a fake TextEmbedding stands in for the ONNX model
  (no model download in CI).

Both fakes produce deterministic one-hot vectors so we can assert
input order is preserved across batches.
"""

from __future__ import annotations

import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest

from metalmind_vault_rag.backends import make_backend
from metalmind_vault_rag.backends.fastembed_backend import FastEmbedBackend
from metalmind_vault_rag.backends.ollama_backend import OllamaBackend


# -----------------------------------------------------------------------------
# Fakes
# -----------------------------------------------------------------------------


def _fake_ollama_transport(dim: int = 4):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/embed":
            payload = json.loads(request.content)
            inputs = payload["input"]
            return httpx.Response(
                200,
                json={
                    "embeddings": [
                        [1.0 if i == idx % dim else 0.0 for i in range(dim)]
                        for idx, _ in enumerate(inputs)
                    ]
                },
            )
        if request.url.path == "/api/embeddings":
            return httpx.Response(200, json={"embedding": [0.0] * dim})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


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


@pytest.fixture(params=["ollama", "fastembed"])
def backend(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    if request.param == "ollama":
        transport = _fake_ollama_transport(dim=4)
        real_client = httpx.Client

        def fake_client(*args, **kwargs):  # noqa: ANN001, ANN002, ANN003
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        monkeypatch.setattr(httpx, "Client", fake_client)
        # batch_size=10 so 3 inputs fit a single batch — keeps the parametric
        # one-hot assertions interpretable across both backends. Ollama's
        # cross-batch order is exercised separately in test_ollama_batches_*.
        yield OllamaBackend(url="http://fake", model="fake-model", dim=4, batch_size=10)
        return

    # fastembed: stub the import so .embed() never reaches the real ONNX runtime.
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
# Factory + Ollama-specific behavior
# -----------------------------------------------------------------------------


def test_make_backend_legacy_returns_ollama(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METALMIND_BACKEND", "legacy")
    instance = make_backend()
    assert isinstance(instance, OllamaBackend)
    assert callable(instance.embed)
    assert callable(instance.dimension)


def test_make_backend_embedded_returns_fastembed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METALMIND_BACKEND", "embedded")
    instance = make_backend()
    assert isinstance(instance, FastEmbedBackend)


def test_make_backend_rejects_unknown_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METALMIND_BACKEND", "nonsense")
    with pytest.raises(ValueError, match="unknown METALMIND_BACKEND"):
        make_backend()


def test_ollama_batches_across_input(monkeypatch: pytest.MonkeyPatch) -> None:
    """OllamaBackend must call /api/embed multiple times when inputs exceed
    its batch size, concatenating results in order. FastEmbed is single-call
    so this lives outside the parametric suite."""
    transport = _fake_ollama_transport(dim=4)
    real_client = httpx.Client

    def fake_client(*args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", fake_client)
    b = OllamaBackend(url="http://fake", model="fake", dim=4, batch_size=2)
    out = b.embed(["a", "b", "c"])
    # First batch [a,b]: idx 0,1 → [1,0,0,0],[0,1,0,0]
    # Second batch [c]:   idx 0   → [1,0,0,0]
    assert out[0] == [1.0, 0.0, 0.0, 0.0]
    assert out[1] == [0.0, 1.0, 0.0, 0.0]
    assert out[2] == [1.0, 0.0, 0.0, 0.0]


def test_cache_dir_defaults_to_metalmind_home(monkeypatch: pytest.MonkeyPatch) -> None:
    """Model cache must live under ~/.metalmind, not the system temp dir —
    macOS purges temp files, leaving a broken half-cache (NO_SUCHFILE)."""
    from metalmind_vault_rag.backends.fastembed_backend import resolve_cache_dir

    monkeypatch.delenv("FASTEMBED_CACHE_PATH", raising=False)
    monkeypatch.setenv("HOME", "/home/tester")
    assert resolve_cache_dir() == "/home/tester/.metalmind/cache/fastembed"


def test_cache_dir_env_override_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    from metalmind_vault_rag.backends.fastembed_backend import resolve_cache_dir

    monkeypatch.setenv("FASTEMBED_CACHE_PATH", "/custom/cache")
    assert resolve_cache_dir() == "/custom/cache"
