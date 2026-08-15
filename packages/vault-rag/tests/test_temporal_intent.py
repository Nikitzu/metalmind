"""Queries that ask about time get ordered by time.

`the most recent plan for making recall trustworthy` scored the same as any
other query: nothing in retrieval read a date, so five plans on one topic came
back in similarity order and the newest was not first. Measured on the
adversarial bench, the temporal class sat at 27% hit@1 against 52% overall.

The trigger is deliberately narrow. `first`, `last`, `after` and `current` are
ordinary words, and a query like `the last step of the writing workflow` or
`the first value after the upgrade` uses them about the content rather than to
pick between notes. `the` does not separate the two, since `the current
guidance` is temporal and `the current versions` is not, so the distinction is
semantic and out of reach of a pattern.

Measured on all 93 adversarial queries, a broad trigger fired 28 times with 13
false positives, lifting the temporal class to 53% while costing two questions
in other classes. The narrow one fires 10 times with none, reaches 47%, and
leaves every other class untouched. Aggregate hit@1 is 55% against 54%, so the
cautious version also happens to be the better one.
"""

from metalmind_vault_rag.search import _apply_temporal_order, _temporal_signal


def hit(file: str, score: float = 1.0) -> dict:
    return {"file": file, "heading": "h", "score": score, "text": "t"}


def files(hits: list[dict]) -> list[str]:
    return [h["file"] for h in hits]


class TestSignal:
    def test_recent_markers_point_forwards(self):
        for q in (
            "the most recent plan for recall quality",
            "what did the vault sync design settle on most recently",
            "the latest of the driver notification tickets",
            "the newest lesson about benchmarks",
            "the host port that came after codex",
        ):
            assert _temporal_signal(q) == 1, q

    def test_older_markers_point_backwards(self):
        for q in (
            "the earliest snapshot of which repos use which package manager",
            "the older of the two trip sharing specs",
            "what did the very first plan set out to do",
            "what did we decide about the release pipeline back in may",
        ):
            assert _temporal_signal(q) == -1, q

    def test_ordinary_uses_of_time_words_do_not_fire(self):
        """Every one of these fired under a broader pattern and cost accuracy."""
        for q in (
            "the last step of the writing workflow was dropped",
            "multi select filters started returning only the first value after the upgrade",
            "which directory should I be in before spawning agents",
            "how far is each frontend app from the current versions",
            "what should I stop doing right after pushing a branch",
            "what got cut from the personal site's first release",
            "plugin update keeps serving the old code after I push commits",
        ):
            assert _temporal_signal(q) == 0, q

    def test_a_query_with_both_directions_prefers_the_older_reading(self):
        assert _temporal_signal("the earliest note about the latest release") == -1

    def test_an_ordinary_query_is_untouched(self):
        assert _temporal_signal("why did we pick postgres over cockroachdb") == 0


class TestOrdering:
    def test_recent_intent_puts_the_newest_first(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(
            search,
            "_note_dates",
            lambda: {"a.md": "2026-01-01", "b.md": "2026-08-01"},
        )
        hits = [hit("a.md", 0.9), hit("b.md", 0.5)]

        assert files(_apply_temporal_order(hits, 1)) == ["b.md", "a.md"]

    def test_older_intent_puts_the_oldest_first(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(
            search,
            "_note_dates",
            lambda: {"a.md": "2026-01-01", "b.md": "2026-08-01"},
        )
        hits = [hit("b.md", 0.9), hit("a.md", 0.5)]

        assert files(_apply_temporal_order(hits, -1)) == ["a.md", "b.md"]

    def test_no_signal_is_a_no_op(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(search, "_note_dates", lambda: {"a.md": "2026-01-01"})
        hits = [hit("a.md", 0.9), hit("b.md", 0.5)]

        assert files(_apply_temporal_order(hits, 0)) == ["a.md", "b.md"]

    def test_score_still_matters(self, monkeypatch):
        """Date is a nudge, not an override. A decisively better match should
        not lose its place to a note that happens to be newer."""
        from metalmind_vault_rag import search

        monkeypatch.setattr(
            search,
            "_note_dates",
            lambda: {"strong.md": "2026-01-01", "weak.md": "2026-08-01"},
        )
        hits = [hit("strong.md", 1.0), hit("weak.md", 0.05)]

        assert files(_apply_temporal_order(hits, 1))[0] == "strong.md"

    def test_undated_notes_are_treated_as_the_middle(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(
            search,
            "_note_dates",
            lambda: {"old.md": "2026-01-01", "new.md": "2026-08-01"},
        )
        hits = [hit("old.md", 0.9), hit("undated.md", 0.9), hit("new.md", 0.9)]

        out = files(_apply_temporal_order(hits, 1))

        assert out[0] == "new.md" and out[-1] == "old.md"

    def test_fewer_than_two_dates_leaves_order_alone(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(search, "_note_dates", lambda: {"a.md": "2026-01-01"})
        hits = [hit("a.md", 0.5), hit("b.md", 0.9)]

        assert files(_apply_temporal_order(hits, 1)) == ["a.md", "b.md"]

    def test_scores_are_not_rewritten(self, monkeypatch):
        from metalmind_vault_rag import search

        monkeypatch.setattr(
            search, "_note_dates", lambda: {"a.md": "2026-01-01", "b.md": "2026-08-01"}
        )
        hits = [hit("a.md", 0.9), hit("b.md", 0.5)]

        assert sorted(h["score"] for h in _apply_temporal_order(hits, 1)) == [0.5, 0.9]


class TestWiredIntoSearch:
    def test_a_temporal_query_reorders_by_date(self, monkeypatch):
        from metalmind_vault_rag import search

        ordered = [hit("Plans/old.md", 0.9), hit("Plans/new.md", 0.5)]
        monkeypatch.setattr(search, "_semantic_search", lambda q, k: ordered)
        monkeypatch.setattr(search, "_keyword_search", lambda q, k: ordered)
        monkeypatch.setattr(search, "_supersede_index", dict)
        monkeypatch.setattr(search, "MAX_CHUNKS_PER_FILE", 0)
        monkeypatch.setattr(
            search,
            "_note_dates",
            lambda: {"Plans/old.md": "2026-01-01", "Plans/new.md": "2026-08-01"},
        )

        assert files(search.search_vault("the most recent plan", k=5))[0] == "Plans/new.md"

    def test_an_ordinary_query_keeps_relevance_order(self, monkeypatch):
        from metalmind_vault_rag import search

        ordered = [hit("Plans/old.md", 0.9), hit("Plans/new.md", 0.5)]
        monkeypatch.setattr(search, "_semantic_search", lambda q, k: ordered)
        monkeypatch.setattr(search, "_keyword_search", lambda q, k: ordered)
        monkeypatch.setattr(search, "_supersede_index", dict)
        monkeypatch.setattr(search, "MAX_CHUNKS_PER_FILE", 0)
        monkeypatch.setattr(
            search,
            "_note_dates",
            lambda: {"Plans/old.md": "2026-01-01", "Plans/new.md": "2026-08-01"},
        )

        assert files(search.search_vault("why postgres", k=5))[0] == "Plans/old.md"


class TestDateExtraction:
    def test_frontmatter_date_is_read(self, tmp_path, monkeypatch):
        from metalmind_vault_rag import search

        note = tmp_path / "a.md"
        note.write_text("---\ncreated: 2026-01-05\nupdated: 2026-07-09\n---\n# a\n")
        monkeypatch.setattr(search, "files_to_index", lambda: [note])
        monkeypatch.setattr(search, "VAULT", tmp_path)
        monkeypatch.setattr(search, "_DATE_CACHE", None, raising=False)
        monkeypatch.setattr(search, "_DATE_KEY", None, raising=False)

        assert search._note_dates()["a.md"] == "2026-07-09"

    def test_filename_date_is_the_fallback(self, tmp_path, monkeypatch):
        from metalmind_vault_rag import search

        note = tmp_path / "2026-03-04-plan.md"
        note.write_text("# no frontmatter\n")
        monkeypatch.setattr(search, "files_to_index", lambda: [note])
        monkeypatch.setattr(search, "VAULT", tmp_path)
        monkeypatch.setattr(search, "_DATE_CACHE", None, raising=False)
        monkeypatch.setattr(search, "_DATE_KEY", None, raising=False)

        assert search._note_dates()["2026-03-04-plan.md"] == "2026-03-04"
