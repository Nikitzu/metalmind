"""Queries and documents embed through different paths.

Retrieval models are trained asymmetrically. Many prepend an instruction to the
query side only, `search_query:` for nomic or a retrieval instruction for
arctic-embed, and comparing a bare query against prefixed passages puts the two
in different regions of the space.

metalmind embedded both sides through `embed()`. That is correct for
`bge-small-en-v1.5`, whose v1.5 release was trained so the instruction is
optional, and the three fastembed paths return bit-identical vectors for it. So
the default has always been right, by luck rather than by design.

It is wrong for every model that needs a prefix. `snowflake-arctic-embed-m`
indexed cleanly, reported healthy, passed doctor, and scored 4% semantic-only
against 35% for the default. Nothing anywhere said a word.
"""

import pytest

from metalmind_vault_rag.backends.fastembed_backend import (
    EMBED_BATCH_SIZE,
    FastEmbedBackend,
)


class FakeModel:
    """Records which fastembed entry point each call arrived through."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []
        self.batch_sizes: list[int | None] = []

    def embed(self, texts, batch_size=None):
        self.calls.append(("embed", list(texts)))
        self.batch_sizes.append(batch_size)
        return [[0.0] for _ in texts]

    def query_embed(self, texts, batch_size=None):
        self.calls.append(("query_embed", list(texts)))
        self.batch_sizes.append(batch_size)
        return [[1.0] for _ in texts]

    def passage_embed(self, texts, batch_size=None):
        self.calls.append(("passage_embed", list(texts)))
        self.batch_sizes.append(batch_size)
        return [[2.0] for _ in texts]


@pytest.fixture
def backend(monkeypatch):
    b = FastEmbedBackend()
    fake = FakeModel()
    monkeypatch.setattr(b, "_ensure_model", lambda: fake)
    return b, fake


class TestBackendPaths:
    def test_documents_go_through_the_passage_path(self, backend):
        b, fake = backend

        b.embed(["a note about postgres"])

        assert fake.calls[0][0] == "passage_embed"

    def test_queries_go_through_the_query_path(self, backend):
        b, fake = backend

        b.embed_query(["why postgres"])

        assert fake.calls[0][0] == "query_embed"

    def test_empty_input_calls_nothing(self, backend):
        b, fake = backend

        assert b.embed([]) == []
        assert b.embed_query([]) == []
        assert fake.calls == []

    def test_order_is_preserved(self, backend):
        b, _ = backend

        assert len(b.embed_query(["one", "two", "three"])) == 3

    def test_batches_are_capped(self, backend):
        """fastembed's default batch is 1024, so a 281-chunk note went through
        the model as one 281 x 512 tensor. The memory for that stays with the
        process, and the watcher reached 8.5 GB over six days."""
        b, fake = backend

        b.embed(["chunk"] * 281)
        b.embed_query(["q"])

        assert fake.batch_sizes == [EMBED_BATCH_SIZE, EMBED_BATCH_SIZE]


class TestOlderFastembed:
    """fastembed gained the asymmetric entry points after the version this
    package first pinned. A wheel without them must keep working rather than
    crash on import of a method that is not there."""

    class Minimal:
        def __init__(self):
            self.calls = []

        def embed(self, texts, batch_size=None):
            self.calls.append("embed")
            return [[0.0] for _ in texts]

    def test_falls_back_to_embed_when_query_path_is_absent(self, monkeypatch):
        b = FastEmbedBackend()
        fake = self.Minimal()
        monkeypatch.setattr(b, "_ensure_model", lambda: fake)

        b.embed_query(["q"])

        assert fake.calls == ["embed"]

    def test_falls_back_to_embed_when_passage_path_is_absent(self, monkeypatch):
        b = FastEmbedBackend()
        fake = self.Minimal()
        monkeypatch.setattr(b, "_ensure_model", lambda: fake)

        b.embed(["d"])

        assert fake.calls == ["embed"]


class TestSearchUsesTheQueryPath:
    def test_search_embeds_the_query_as_a_query(self, monkeypatch):
        """The wiring, not the backend. `_semantic_search` embedding the query
        through the document path is the whole defect."""
        from metalmind_vault_rag import core, search

        seen: list[str] = []

        class Recording:
            def embed(self, texts):
                seen.append("embed")
                return [[0.0] * 4 for _ in texts]

            def embed_query(self, texts):
                seen.append("embed_query")
                return [[0.0] * 4 for _ in texts]

            def dimension(self):
                return 4

            def model_id(self):
                return "fake"

        monkeypatch.setattr(core, "_backend", None, raising=False)
        monkeypatch.setattr(core, "embedding_backend", lambda: Recording())
        monkeypatch.setattr(search, "vector_store", lambda: _EmptyStore())

        search._semantic_search("why postgres", 5)

        assert seen == ["embed_query"]


class _EmptyStore:
    def query(self, vec, k):
        return []
