"""Ollama-backed EmbeddingBackend. Wraps the v0.4.x in-tree behavior so
the indexer and search layer talk to the abstraction instead.

No new behavior: the `/api/embed` batch path with `/api/embeddings`
fallback was previously inlined in `core.embed`. Slice 3 of the v0.5.0
plan extracts it into a class so the FastEmbedBackend (Slice 4) can
drop in alongside.
"""

from __future__ import annotations

import os

import httpx


class OllamaBackend:
    """Ollama HTTP client. One instance per process; httpx.Client is
    re-created on each call to keep call sites simple - embed batches
    are infrequent enough that connection-pool benefit is negligible."""

    def __init__(
        self,
        url: str | None = None,
        model: str | None = None,
        dim: int | None = None,
        batch_size: int | None = None,
    ) -> None:
        self._url = url or os.environ.get("VAULT_OLLAMA_URL", "http://localhost:11434")
        self._model = model or os.environ.get("VAULT_EMBED_MODEL", "nomic-embed-text")
        self._dim = dim if dim is not None else int(os.environ.get("VAULT_EMBED_DIM", "768"))
        self._batch_size = batch_size or int(os.environ.get("VAULT_EMBED_BATCH", "64"))

    def dimension(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        out: list[list[float]] = []
        with httpx.Client(timeout=120) as c:
            i = 0
            use_legacy = False
            while i < len(texts):
                batch = texts[i : i + self._batch_size]
                if not use_legacy:
                    r = c.post(
                        f"{self._url}/api/embed",
                        json={"model": self._model, "input": batch},
                    )
                    if r.status_code == 404:
                        use_legacy = True
                    else:
                        r.raise_for_status()
                        out.extend(r.json()["embeddings"])
                        i += len(batch)
                        continue
                # Legacy fallback: one-at-a-time on older Ollama servers.
                for t in batch:
                    lr = c.post(
                        f"{self._url}/api/embeddings",
                        json={"model": self._model, "prompt": t},
                    )
                    lr.raise_for_status()
                    out.append(lr.json()["embedding"])
                i += len(batch)
        return out
