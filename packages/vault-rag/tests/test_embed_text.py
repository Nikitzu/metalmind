"""What the embedder sees, as against what is stored.

A chunk reading "it depends on the lock ordering" is unfindable on its own. The
same chunk embedded with the note it came from and the section it sits under is
not. The heading path was already computed and carried in the payload; it just
never reached the embedder.

Only the embedded string changes. Stored text, FTS rows and snippets stay the
text a person wrote, so neighbours and output are untouched.
"""

from metalmind_vault_rag.core import embed_text


class TestContext:
    def test_a_section_carries_its_note_and_heading(self):
        out = embed_text("Learnings/sqlite-concurrency.md", "sqlite concurrency / WAL mode", "it depends on the lock ordering")

        assert "sqlite concurrency" in out
        assert "WAL mode" in out
        assert "it depends on the lock ordering" in out

    def test_the_title_is_not_repeated_when_the_heading_already_has_it(self):
        """scribe generates the slug from the H1, so for most notes the heading
        path already opens with the title. Prepending it again would double that
        text's weight in the embedding for no signal."""
        out = embed_text(
            "Learnings/a-parameter-is-only-valid.md",
            "a parameter is only valid / The pattern",
            "body",
        )

        assert out.count("a parameter is only valid") == 1

    def test_a_root_chunk_gets_the_note_title_alone(self):
        out = embed_text("Work/board.md", "(root)", "frontmatter and preamble")

        assert "board" in out
        assert "(root)" not in out

    def test_a_hand_made_note_whose_heading_differs_keeps_both(self):
        out = embed_text("Inbox/clipping.md", "Some Other Title / Detail", "body")

        assert "clipping" in out
        assert "Some Other Title" in out


class TestTitleFromFilename:
    def test_hyphens_and_underscores_become_spaces(self):
        out = embed_text("Learnings/foo-bar_baz.md", "(root)", "x")

        assert "foo bar baz" in out

    def test_the_directory_and_extension_are_dropped(self):
        out = embed_text("Work/MOCs/metalmind.md", "(root)", "x")

        assert "metalmind" in out
        assert ".md" not in out
        assert "MOCs" not in out


class TestTextIsPreserved:
    def test_the_chunk_text_survives_verbatim(self):
        text = "Raising shared_buffers changed the plan; see PT-4724."

        assert text in embed_text("a-note.md", "a note / Body", text)

    def test_an_empty_heading_does_not_produce_a_dangling_separator(self):
        out = embed_text("a-note.md", "", "body")

        assert not out.startswith("/")
        assert " / :" not in out


class TestWiring:
    def test_the_indexer_embeds_context_but_stores_the_bare_text(self, monkeypatch):
        """The seam this whole change lives on. Embedding context while storing
        it too would change every snippet and break neighbour lookups."""
        from metalmind_vault_rag import indexer

        seen: list[str] = []

        class Backend:
            def embed(self, texts):
                seen.extend(texts)
                return [[0.0] for _ in texts]

        monkeypatch.setattr(indexer, "embedding_backend", lambda: Backend())

        points = indexer._embed_chunks("Learnings/lock-ordering.md", [("lock ordering / WAL", "it depends")])

        assert seen == ["lock ordering / WAL: it depends"]
        assert points[0].payload["text"] == "it depends"
