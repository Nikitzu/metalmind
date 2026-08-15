"""A note must never outrank the successor it names.

The 0.4x supersede penalty is a soft multiplier competing against score
magnitude, which holds while scores come from RRF and stops holding when they
come from a cross-encoder. Measured on the adversarial bench: reranking dropped
`competing-near-duplicates` from 80% to 55% hit@1, and two of the six regressions
were a superseded note winning outright.

A multiplier large enough to survive a confident cross-encoder would also bury
superseded notes that are the only answer. So this is expressed as a constraint
instead: whatever the scores say, a successor present in the same candidate set
ranks above its predecessor. Ordering among everything else is untouched.
"""

import pytest

from metalmind_vault_rag.search import _enforce_supersede_order


def hit(file: str, score: float = 1.0) -> dict:
    return {"file": file, "heading": "h", "score": score, "text": "t"}


def files(hits: list[dict]) -> list[str]:
    return [h["file"] for h in hits]


class TestConstraint:
    def test_successor_is_promoted_above_its_predecessor(self):
        hits = [hit("Plans/old.md"), hit("Plans/new.md")]
        smap = {"Plans/old.md": "new"}

        assert files(_enforce_supersede_order(hits, smap)) == ["Plans/new.md", "Plans/old.md"]

    def test_ordering_is_untouched_when_already_correct(self):
        hits = [hit("Plans/new.md"), hit("Plans/old.md")]
        smap = {"Plans/old.md": "new"}

        assert files(_enforce_supersede_order(hits, smap)) == ["Plans/new.md", "Plans/old.md"]

    def test_unrelated_hits_keep_their_relative_order(self):
        hits = [hit("a.md"), hit("Plans/old.md"), hit("b.md"), hit("Plans/new.md"), hit("c.md")]
        smap = {"Plans/old.md": "new"}

        out = files(_enforce_supersede_order(hits, smap))

        assert out.index("Plans/new.md") < out.index("Plans/old.md")
        assert [f for f in out if f in {"a.md", "b.md", "c.md"}] == ["a.md", "b.md", "c.md"]

    def test_absent_successor_leaves_the_hit_where_it_is(self):
        """Promoting a note that was never retrieved is not possible, and
        demoting the predecessor on that basis would hide a hit for no gain."""
        hits = [hit("Plans/old.md"), hit("other.md")]
        smap = {"Plans/old.md": "new"}

        assert files(_enforce_supersede_order(hits, smap)) == ["Plans/old.md", "other.md"]

    def test_status_superseded_without_a_pointer_is_left_alone(self):
        hits = [hit("Plans/old.md"), hit("Plans/new.md")]
        smap = {"Plans/old.md": ""}

        assert files(_enforce_supersede_order(hits, smap)) == ["Plans/old.md", "Plans/new.md"]

    def test_no_supersede_map_is_a_no_op(self):
        hits = [hit("a.md"), hit("b.md")]

        assert files(_enforce_supersede_order(hits, {})) == ["a.md", "b.md"]


class TestChains:
    def test_a_chain_orders_newest_first(self):
        hits = [hit("v1.md"), hit("v2.md"), hit("v3.md")]
        smap = {"v1.md": "v2", "v2.md": "v3"}

        assert files(_enforce_supersede_order(hits, smap)) == ["v3.md", "v2.md", "v1.md"]

    def test_a_cycle_terminates_rather_than_looping(self):
        """Nothing prevents a user writing two notes that supersede each other.
        The ordering that results is arbitrary; not returning is not an option."""
        hits = [hit("a.md"), hit("b.md")]
        smap = {"a.md": "b", "b.md": "a"}

        out = _enforce_supersede_order(hits, smap)

        assert sorted(files(out)) == ["a.md", "b.md"]

    def test_self_supersede_does_not_hang(self):
        hits = [hit("a.md")]
        smap = {"a.md": "a"}

        assert files(_enforce_supersede_order(hits, smap)) == ["a.md"]


class TestPathResolution:
    def test_pointer_matches_on_stem_not_full_path(self):
        """`superseded_by` holds a bare stem, while hits carry vault-relative
        paths, so the two only meet after the directory is stripped."""
        hits = [hit("Archive/Plans/2026-01-01-old.md"), hit("Plans/2026-06-01-new.md")]
        smap = {"Archive/Plans/2026-01-01-old.md": "2026-06-01-new"}

        out = files(_enforce_supersede_order(hits, smap))

        assert out == ["Plans/2026-06-01-new.md", "Archive/Plans/2026-01-01-old.md"]

    def test_a_stem_colliding_across_folders_promotes_the_first_match(self):
        hits = [hit("Plans/old.md"), hit("Work/new.md"), hit("Archive/new.md")]
        smap = {"Plans/old.md": "new"}

        out = files(_enforce_supersede_order(hits, smap))

        assert out.index("Work/new.md") < out.index("Plans/old.md")


class TestScoresUntouched:
    def test_reordering_does_not_rewrite_scores(self):
        hits = [hit("Plans/old.md", score=0.9), hit("Plans/new.md", score=0.1)]
        smap = {"Plans/old.md": "new"}

        out = _enforce_supersede_order(hits, smap)

        assert [h["score"] for h in out] == [0.1, 0.9]


@pytest.mark.parametrize("size", [0, 1])
def test_trivial_inputs(size):
    hits = [hit("a.md")][:size]
    assert len(_enforce_supersede_order(hits, {"a.md": "b"})) == size


class TestWiredIntoSearch:
    """The constraint is worthless unless `search_vault` calls it, and the
    rerank path is the one that motivated it. Both are asserted here because a
    correct helper nobody invokes is the failure this arc already hit once."""

    @pytest.fixture(autouse=True)
    def stub_legs(self, monkeypatch):
        from metalmind_vault_rag import search

        ordered = [hit("Plans/old.md", score=0.9), hit("Plans/new.md", score=0.1)]
        monkeypatch.setattr(search, "_semantic_search", lambda q, k: ordered)
        monkeypatch.setattr(search, "_keyword_search", lambda q, k: ordered)
        monkeypatch.setattr(search, "_supersede_index", lambda: {"Plans/old.md": "new"})
        monkeypatch.setattr(search, "MAX_CHUNKS_PER_FILE", 0)

    def test_fusion_path_puts_the_successor_first(self):
        """Asserts the outcome, not the mechanism. In RRF space the 0.4x penalty
        is already decisive, so this passes with the constraint removed. That is
        the point: fusion never needed it, which is why hybrid scored 80% on the
        bench while reranking scored 55%. Kept as a regression guard on the
        property both paths must hold."""
        from metalmind_vault_rag import search

        hits = search.search_vault("q", k=5)

        assert files(hits)[0] == "Plans/new.md"

    def test_rerank_path_applies_the_constraint(self, monkeypatch):
        """The cross-encoder is stubbed to prefer the superseded note, which is
        what it does in practice: that note is usually the longer and more
        on-topic document."""
        from metalmind_vault_rag import search

        def fake_rerank(query, hits, k, penalties=None):
            ranked = sorted(hits, key=lambda h: 0 if h["file"] == "Plans/old.md" else 1)
            return ranked[:k]

        monkeypatch.setattr(search, "rerank_hits", fake_rerank)

        hits = search.search_vault("q", k=5, rerank=True)

        assert files(hits)[0] == "Plans/new.md"

    def test_rerank_sees_every_candidate_before_truncation(self, monkeypatch):
        """Truncating to k before the constraint runs would hide a successor
        sitting just outside the window, which is where it often sits."""
        from metalmind_vault_rag import search

        seen = {}

        def fake_rerank(query, hits, k, penalties=None):
            seen["k"] = k
            seen["n"] = len(hits)
            return hits[:k]

        monkeypatch.setattr(search, "rerank_hits", fake_rerank)

        search.search_vault("q", k=1, rerank=True)

        assert seen["k"] == seen["n"]
