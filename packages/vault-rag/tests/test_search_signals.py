"""Per-leg score fields carried through RRF fusion.

Fusion ranks by position and discards score magnitude, so a fused score of
0.13 means the same thing whether the top hit was a bullseye or the least-bad
of a bad set. The LongMemEval abstention column measured the consequence:
fused scores separate answerable from unanswerable questions at AUC 0.549, a
coin flip. `sem_score` and `kw_score` preserve each retriever's raw score so a
caller can recover that lost magnitude. They are diagnostics only and must
never change the fused ordering.
"""

from metalmind_vault_rag.search import _rrf_merge


def hit(file: str, heading: str = "h", score: float = 1.0) -> dict:
    return {"file": file, "heading": heading, "score": score, "text": "t"}


LABELS = ["sem", "kw"]


class TestPerLegScores:
    def test_both_legs_recorded_when_both_return_the_document(self):
        sem = [hit("a.md", score=0.82)]
        kw = [hit("a.md", score=11.4)]

        merged = _rrf_merge([sem, kw], k=5, labels=LABELS)

        assert merged[0]["sem_score"] == 0.82
        assert merged[0]["kw_score"] == 11.4

    def test_missing_leg_is_none_not_zero(self):
        sem = [hit("a.md", score=0.82)]
        kw = [hit("b.md", score=11.4)]

        merged = _rrf_merge([sem, kw], k=5, labels=LABELS)
        by_file = {h["file"]: h for h in merged}

        assert by_file["a.md"]["sem_score"] == 0.82
        assert by_file["a.md"]["kw_score"] is None
        assert by_file["b.md"]["sem_score"] is None
        assert by_file["b.md"]["kw_score"] == 11.4

    def test_best_ranked_occurrence_wins_within_a_leg(self):
        sem = [hit("a.md", heading="one", score=0.9), hit("a.md", heading="two", score=0.4)]

        merged = _rrf_merge([sem, []], k=5, labels=LABELS)
        by_heading = {h["heading"]: h for h in merged}

        assert by_heading["one"]["sem_score"] == 0.9
        assert by_heading["two"]["sem_score"] == 0.4

    def test_raw_scores_survive_the_folder_multiplier(self):
        sem = [hit("Archive/old.md", score=0.95)]
        kw = [hit("Archive/old.md", score=9.0)]

        merged = _rrf_merge([sem, kw], k=5, labels=LABELS)

        assert merged[0]["sem_score"] == 0.95
        assert merged[0]["kw_score"] == 9.0
        assert merged[0]["score"] < 0.95


class TestOrderingUnchanged:
    def test_labels_do_not_affect_fused_order_or_score(self):
        sem = [hit("a.md", score=0.1), hit("b.md", score=0.9)]
        kw = [hit("b.md", score=2.0), hit("c.md", score=1.0)]

        plain = _rrf_merge([sem, kw], k=5)
        labelled = _rrf_merge([sem, kw], k=5, labels=LABELS)

        assert [h["file"] for h in plain] == [h["file"] for h in labelled]
        assert [h["score"] for h in plain] == [h["score"] for h in labelled]

    def test_no_label_fields_when_labels_omitted(self):
        merged = _rrf_merge([[hit("a.md")], []], k=5)

        assert "sem_score" not in merged[0]
        assert "kw_score" not in merged[0]
