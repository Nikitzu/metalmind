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

from metalmind_vault_rag.search import _rrf_merge

LABELS = ["sem", "kw"]


def hit(file="a.md", heading="Note / Body", text="t", score=1.0, chunk_idx=None):
    h = {"file": file, "heading": heading, "text": text, "score": score}
    if chunk_idx is not None:
        h["chunk_idx"] = chunk_idx
    return h


class TestChunksAreDistinct:
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

    def test_a_mixed_index_does_not_crash(self):
        sem = [hit(text="stamped", chunk_idx=0), hit(text="legacy")]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)

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
