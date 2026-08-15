"""What counts as one document during fusion.

`_rrf_merge` de-duplicated on `(file, heading)`, which is a proxy for chunk
identity that holds only while a section yields exactly one chunk. Two chunks
from the same section collapsed into one hit keeping whichever retriever
answered first, which is neither the best scoring nor a deliberate choice.

On the maintainer vault that hid 76 of 3353 chunks. It matters far more than
that number suggests, because sentence-boundary splits with overlap exist to
produce more chunks per section: shipping them against this key would make
retrieval worse and the bench would show it without saying why.
"""

import pytest

from metalmind_vault_rag.search import _rrf_merge

LABELS = ["sem", "kw"]


def hit(file="a.md", heading="Note / Body", text="t", score=1.0, chunk_idx=None):
    h = {"file": file, "heading": heading, "text": text, "score": score}
    if chunk_idx is not None:
        h["chunk_idx"] = chunk_idx
    return h


class TestChunksAreDistinct:
    """Merging semantics, with the per-file cap off. The cap shapes what reaches
    a result set and is a separate concern with its own tests below; these
    assert that fusion stops conflating different chunks in the first place."""

    @pytest.fixture(autouse=True)
    def uncapped(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(search, "MAX_CHUNKS_PER_FILE", 0)

    def test_two_chunks_of_one_section_both_survive(self):
        sem = [hit(text="first", chunk_idx=0), hit(text="second", chunk_idx=1)]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 2
        assert {m["text"] for m in merged} == {"first", "second"}

    def test_a_long_section_keeps_every_part(self):
        sem = [hit(text=f"part {i}", chunk_idx=i) for i in range(6)]

        merged = _rrf_merge([sem, []], k=10, labels=LABELS)

        assert len(merged) == 6

    def test_the_same_chunk_from_both_retrievers_still_merges(self):
        sem = [hit(text="shared", chunk_idx=2, score=0.9)]
        kw = [hit(text="shared", chunk_idx=2, score=11.0)]

        merged = _rrf_merge([sem, kw], k=5, labels=LABELS)

        assert len(merged) == 1
        assert merged[0]["sem_score"] == 0.9
        assert merged[0]["kw_score"] == 11.0

    def test_chunks_of_different_sections_were_never_the_problem(self):
        sem = [hit(heading="Note / One", chunk_idx=0), hit(heading="Note / Two", chunk_idx=0)]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 2


class TestLegacyIndexes:
    def test_hits_without_a_chunk_index_behave_as_before(self):
        """A format 1 index carries no chunk_idx. It is reported stale and keeps
        answering, so fusion has to tolerate the old shape rather than crash or
        treat every chunk as unique."""
        sem = [hit(text="first"), hit(text="second")]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 1

    def test_the_same_chunk_still_merges_when_only_one_leg_knows_its_position(self):
        """FTS has always had a chunk_idx column; the vector payload never did.
        On a format 1 index the keyword leg therefore reports a position and the
        semantic leg does not, so keying on it unconditionally splits every hit
        the two retrievers agreed on and destroys the agreement signal fusion
        exists to capture."""
        sem = [hit(text="shared", score=0.9)]
        kw = [hit(text="shared", score=11.0, chunk_idx=0)]

        merged = _rrf_merge([sem, kw], k=5, labels=LABELS)

        assert len(merged) == 1
        assert merged[0]["sem_score"] == 0.9
        assert merged[0]["kw_score"] == 11.0

    def test_a_partially_stamped_list_falls_back_rather_than_guessing(self):
        sem = [hit(text="stamped", chunk_idx=0), hit(text="legacy")]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 1


class TestIdentityToggle:
    """`METALMIND_CHUNK_IDENTITY=0` reproduces pre-format-2 fusion against a
    current index, so the arc's open question can be measured without a rebuild.
    It has to reach the collapse itself, not merely read the variable, or a run
    under the toggle would silently measure the shipped behaviour."""

    @pytest.fixture(autouse=True)
    def uncapped(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(search, "MAX_CHUNKS_PER_FILE", 0)

    def test_disabled_identity_collapses_chunks_of_one_section(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(search, "CHUNK_IDENTITY", False)
        sem = [hit(text="first", chunk_idx=0), hit(text="second", chunk_idx=1)]

        merged = search._rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 1

    def test_enabled_is_the_default_and_keeps_them_apart(self):
        sem = [hit(text="first", chunk_idx=0), hit(text="second", chunk_idx=1)]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 2

    def test_disabling_identity_does_not_disturb_distinct_sections(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(search, "CHUNK_IDENTITY", False)
        sem = [
            hit(heading="Note / One", text="one", chunk_idx=0),
            hit(heading="Note / Two", text="two", chunk_idx=0),
        ]

        merged = search._rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 2


class TestNeighboursFromIndex:
    def test_a_hit_that_knows_its_position_needs_no_text_lookup(self, tmp_path, monkeypatch):
        """Overlapping chunks share text, so the old lookup would match two rows
        and `LIMIT 1` would pick one arbitrarily. A hit carrying chunk_idx is
        unambiguous."""
        import sqlite3

        from metalmind_vault_rag import search

        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE chunks (file, heading, chunk_idx, text)")
        shared = "the overlapping sentence"
        conn.executemany(
            "INSERT INTO chunks VALUES (?,?,?,?)",
            [
                ("a.md", "h", 0, shared),
                ("a.md", "h", 1, shared),
                ("a.md", "h", 2, "third"),
            ],
        )
        monkeypatch.setattr(search, "fts_conn", lambda: conn)

        hits = [{"file": "a.md", "heading": "h", "text": shared, "chunk_idx": 1}]
        search.attach_neighbors(hits)

        assert hits[0]["neighbor_text"]["prev"] == shared
        assert hits[0]["neighbor_text"]["next"] == "third"


class TestBothLegsReportPosition:
    def test_the_indexer_stores_the_chunk_position(self, monkeypatch):
        from metalmind_vault_rag import indexer

        monkeypatch.setattr(
            indexer, "embedding_backend", lambda: type("B", (), {"embed": lambda s, t: [[0.0]] * len(t)})()
        )

        points = indexer._embed_chunks("a.md", [("h", "one"), ("h", "two")])

        assert [p.payload["chunk_idx"] for p in points] == [0, 1]

    def test_the_keyword_leg_reports_the_chunk_position(self, monkeypatch):
        import sqlite3

        from metalmind_vault_rag import search

        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE VIRTUAL TABLE chunks USING fts5(file, heading, chunk_idx, text)")
        conn.executemany(
            "INSERT INTO chunks VALUES (?,?,?,?)",
            [("a.md", "h", "0", "alpha content"), ("a.md", "h", "1", "alpha again")],
        )
        monkeypatch.setattr(search, "fts_conn", lambda: conn)

        hits = search._keyword_search("alpha", 5)

        assert len(hits) == 2
        assert {str(h["chunk_idx"]) for h in hits} == {"0", "1"}


class TestPerFileCap:
    def test_only_the_best_chunk_of_a_note_reaches_the_result_set(self):
        """Identity by position lets the best chunk of a note claim the slot
        rather than the arbitrary first-seen one. Without a cap it also lets one
        note fill the list with itself: measured, that cost 3 points of hit@5."""
        sem = [hit(text=f"c{i}", score=1.0 - i / 10, chunk_idx=i) for i in range(4)]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

        assert len(merged) == 1
        assert merged[0]["text"] == "c0"

    def test_other_notes_still_get_their_slots(self):
        sem = [
            hit(file="a.md", text="a0", score=0.9, chunk_idx=0),
            hit(file="a.md", text="a1", score=0.8, chunk_idx=1),
            hit(file="b.md", text="b0", score=0.7, chunk_idx=0),
        ]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

        assert [m["file"] for m in merged] == ["a.md", "b.md"]

    def test_the_cap_can_be_turned_off(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(search, "MAX_CHUNKS_PER_FILE", 0)
        sem = [hit(text=f"c{i}", score=1.0 - i / 10, chunk_idx=i) for i in range(4)]

        assert len(search._rrf_merge([sem, []], k=5, labels=LABELS)) == 4
