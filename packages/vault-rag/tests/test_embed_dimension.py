"""The embedding dimension is derived from the model, not asserted by hand.

`VAULT_EMBED_MODEL` and `VAULT_EMBED_DIM` were independent, so choosing a model
meant remembering to change a second variable. Getting it wrong was silent:
`dimension()` returned 384 while the model produced 768-length vectors, and the
vector store sized its index on the lie.

The dimension is a property of the model, so the model is asked. An explicit
override that contradicts it is refused rather than believed, because a caller
who passes the wrong number is not expressing a preference.
"""

import pytest

from metalmind_vault_rag.backends.fastembed_backend import (
    DEFAULT_DIM,
    DEFAULT_MODEL,
    FastEmbedBackend,
    model_dimension,
)


class TestModelDimension:
    def test_known_model_reports_its_own_dimension(self):
        assert model_dimension(DEFAULT_MODEL) == DEFAULT_DIM
        assert model_dimension("BAAI/bge-base-en-v1.5") == 768
        assert model_dimension("mixedbread-ai/mxbai-embed-large-v1") == 1024

    def test_unknown_model_reports_nothing_rather_than_guessing(self):
        assert model_dimension("some-org/not-a-real-model") is None


class TestBackendDimension:
    def test_dimension_follows_the_model_without_an_env_var(self, monkeypatch):
        monkeypatch.setenv("VAULT_EMBED_MODEL", "BAAI/bge-base-en-v1.5")
        monkeypatch.delenv("VAULT_EMBED_DIM", raising=False)

        assert FastEmbedBackend().dimension() == 768

    def test_default_model_is_unchanged(self, monkeypatch):
        monkeypatch.delenv("VAULT_EMBED_MODEL", raising=False)
        monkeypatch.delenv("VAULT_EMBED_DIM", raising=False)

        b = FastEmbedBackend()

        assert b.model_id() == DEFAULT_MODEL
        assert b.dimension() == DEFAULT_DIM

    def test_a_contradicting_override_is_refused(self, monkeypatch):
        monkeypatch.setenv("VAULT_EMBED_MODEL", "BAAI/bge-base-en-v1.5")
        monkeypatch.setenv("VAULT_EMBED_DIM", "384")

        with pytest.raises(ValueError) as err:
            FastEmbedBackend()

        message = str(err.value)
        assert "768" in message and "384" in message
        assert "VAULT_EMBED_DIM" in message

    def test_a_matching_override_is_accepted(self, monkeypatch):
        monkeypatch.setenv("VAULT_EMBED_MODEL", "BAAI/bge-base-en-v1.5")
        monkeypatch.setenv("VAULT_EMBED_DIM", "768")

        assert FastEmbedBackend().dimension() == 768

    def test_an_override_is_trusted_for_a_model_fastembed_does_not_know(self, monkeypatch):
        """A model outside fastembed's catalogue cannot be checked, so an
        explicit dimension is the only information available and is taken at
        face value."""
        monkeypatch.setenv("VAULT_EMBED_MODEL", "some-org/not-a-real-model")
        monkeypatch.setenv("VAULT_EMBED_DIM", "512")

        assert FastEmbedBackend().dimension() == 512

    def test_an_unknown_model_without_an_override_says_what_to_do(self, monkeypatch):
        monkeypatch.setenv("VAULT_EMBED_MODEL", "some-org/not-a-real-model")
        monkeypatch.delenv("VAULT_EMBED_DIM", raising=False)

        with pytest.raises(ValueError) as err:
            FastEmbedBackend()

        assert "VAULT_EMBED_DIM" in str(err.value)

    def test_explicit_constructor_arguments_still_win(self):
        assert FastEmbedBackend(model_name=DEFAULT_MODEL, dim=DEFAULT_DIM).dimension() == DEFAULT_DIM
