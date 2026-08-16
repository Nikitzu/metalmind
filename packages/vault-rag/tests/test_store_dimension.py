"""The store's vector width comes from the model, like the backend's.

T3 made the backend derive its dimension from fastembed's catalogue, but the
store kept reading VAULT_EMBED_DIM directly with a hardcoded 384 default. Two
independent sources for one number is the defect T3 existed to remove, and
fixing one of the two turned a silent mismatch into a loud one only on the
backend side:

    model=mixedbread-ai/mxbai-embed-large-v1 dim=1024
    ValueError: vector dimension mismatch: got 1024, store expects 384

That is a 410-second index run wasted on a disagreement between two lines of
this package.
"""

import pytest

from metalmind_vault_rag.stores.sqlite_vec_store import SqliteVecStore


class TestStoreDimension:
    def test_dimension_follows_the_model(self, monkeypatch, tmp_path):
        monkeypatch.setenv("VAULT_EMBED_MODEL", "mixedbread-ai/mxbai-embed-large-v1")
        monkeypatch.delenv("VAULT_EMBED_DIM", raising=False)

        store = SqliteVecStore(db_path=tmp_path / "vec.db", collection="t")

        assert store._dim == 1024

    def test_default_model_is_unchanged(self, monkeypatch, tmp_path):
        monkeypatch.delenv("VAULT_EMBED_MODEL", raising=False)
        monkeypatch.delenv("VAULT_EMBED_DIM", raising=False)

        store = SqliteVecStore(db_path=tmp_path / "vec.db", collection="t")

        assert store._dim == 384

    def test_explicit_argument_still_wins(self, tmp_path):
        store = SqliteVecStore(db_path=tmp_path / "vec.db", collection="t", dim=99)

        assert store._dim == 99

    def test_store_and_backend_agree_without_any_env_var(self, monkeypatch, tmp_path):
        """The property that was violated. Whatever the model, the width the
        store builds its index at is the width the backend emits."""
        from metalmind_vault_rag.backends.fastembed_backend import FastEmbedBackend

        for model, expected in (
            ("BAAI/bge-small-en-v1.5", 384),
            ("BAAI/bge-base-en-v1.5", 768),
            ("mixedbread-ai/mxbai-embed-large-v1", 1024),
        ):
            monkeypatch.setenv("VAULT_EMBED_MODEL", model)
            monkeypatch.delenv("VAULT_EMBED_DIM", raising=False)

            store = SqliteVecStore(db_path=tmp_path / f"vec-{expected}.db", collection="t")

            assert store._dim == FastEmbedBackend().dimension() == expected, model

    def test_a_contradicting_override_is_refused(self, monkeypatch, tmp_path):
        monkeypatch.setenv("VAULT_EMBED_MODEL", "BAAI/bge-base-en-v1.5")
        monkeypatch.setenv("VAULT_EMBED_DIM", "384")

        with pytest.raises(ValueError):
            SqliteVecStore(db_path=tmp_path / "vec.db", collection="t")
