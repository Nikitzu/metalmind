"""Protocol-contract tests for EmbeddingBackend implementations.

OllamaBackend is exercised against a fake httpx transport — same API
surface a real Ollama server returns, no daemon needed. FastEmbedBackend
will join this suite in Slice 4 of the v0.5.0 plan.

Tests prove the backend honors the contract (empty input safe, length
matches input, dimension is stable). Real model quality is the bench's
job, not this suite's.
"""

from __future__ import annotations

import json

import httpx
import pytest

from metalmind_vault_rag.backends import EmbeddingBackend, make_backend
from metalmind_vault_rag.backends.ollama_backend import OllamaBackend


def _fake_ollama_transport(dim: int = 4):
    """httpx mock transport that replies to /api/embed with deterministic
    vectors (one-hot per text, padded to dim) so we can assert order."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/embed":
            payload = json.loads(request.content)
            inputs = payload["input"]
            embeddings = [
                [1.0 if i == idx % dim else 0.0 for i in range(dim)]
                for idx, _ in enumerate(inputs)
            ]
            return httpx.Response(200, json={"embeddings": embeddings})
        if request.url.path == "/api/embeddings":
            return httpx.Response(200, json={"embedding": [0.0] * dim})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.fixture
def ollama_backend(monkeypatch: pytest.MonkeyPatch) -> OllamaBackend:
    """OllamaBackend wired to a mock transport. Patches httpx.Client to
    inject the fake transport — same code path the watcher uses."""
    transport = _fake_ollama_transport(dim=4)
    real_client = httpx.Client

    def fake_client(*args, **kwargs):  # noqa: ANN401, ANN002, ANN003
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", fake_client)
    return OllamaBackend(url="http://fake", model="fake-model", dim=4, batch_size=2)


def test_embed_empty_input_returns_empty(ollama_backend: OllamaBackend) -> None:
    assert ollama_backend.embed([]) == []


def test_embed_returns_one_vector_per_input(ollama_backend: OllamaBackend) -> None:
    out = ollama_backend.embed(["a", "b", "c"])
    assert len(out) == 3
    assert all(len(v) == 4 for v in out)


def test_embed_batches_across_input(ollama_backend: OllamaBackend) -> None:
    """batch_size=2, three inputs → must invoke twice and concat in order."""
    out = ollama_backend.embed(["a", "b", "c"])
    # First batch (a, b): expects [1,0,0,0], [0,1,0,0]
    # Second batch (c): expects [1,0,0,0] (idx % 4 = 0)
    assert out[0] == [1.0, 0.0, 0.0, 0.0]
    assert out[1] == [0.0, 1.0, 0.0, 0.0]
    assert out[2] == [1.0, 0.0, 0.0, 0.0]


def test_dimension_is_stable(ollama_backend: OllamaBackend) -> None:
    assert ollama_backend.dimension() == 4
    assert ollama_backend.dimension() == 4


def test_make_backend_factory_returns_protocol_compatible_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("METALMIND_BACKEND", "legacy")
    instance = make_backend()
    assert isinstance(instance, OllamaBackend)
    # Duck-type: implements EmbeddingBackend Protocol (Protocol isn't checked
    # at runtime; verify by attribute presence + callable types).
    assert callable(instance.embed)
    assert callable(instance.dimension)


def test_make_backend_rejects_unknown_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("METALMIND_BACKEND", "nonsense")
    with pytest.raises(ValueError, match="unknown METALMIND_BACKEND"):
        make_backend()
