"""The reranker informs the ranking rather than replacing it.

Traced on the adversarial bench, every query reranking made worse was the same
shape: two notes in one family, and the wrong one chosen. `evertsenstraat-6`
lost to `warmoesstraat-120`, `arg-81` to `arg-36`, the 05-20 investigation to
the 05-21 one. BM25 had put the right one in the candidate set by matching the
token that distinguishes it, and two lines then threw that away.

The first was scoring `(query, chunk_text)` with no identity attached, so on
five traced cases the distinguishing token was absent from what the
cross-encoder saw in four; one chunk was 133 characters naming neither the
street nor the town it was supposed to identify. The second was sorting on the
cross-encoder score alone, discarding the fusion rank entirely.

Measured across an alpha sweep, fusing the two rankings at equal weight with
the title supplied takes competing-near-duplicates from 65% to 85% hit@1 and
the aggregate from 58% to 63%, while pure replacement loses that class no
matter what the reranker is shown.
"""

import pytest

from metalmind_vault_rag import rerank


def hit(file: str, score: float = 1.0, text: str = "body") -> dict:
    return {"file": file, "heading": "h", "score": score, "text": text}


def files(hits) -> list[str]:
    return [h["file"] for h in hits]


@pytest.fixture
def scored(monkeypatch):
    """Drive the cross-encoder from a dict of file -> score, and record the
    text it was asked to judge."""
    seen: list[tuple[str, str]] = []

    def install(scores: dict[str, float]):
        monkeypatch.setattr(rerank, "_load", lambda: ("session", "tokenizer"))

        def fake_batch(session, tokenizer, pairs):
            seen.extend(pairs)
            return [scores[p[1].split("\n")[0].strip()] for p in pairs]

        monkeypatch.setattr(rerank, "_score_batch", fake_batch)
        return seen

    return install


class TestTitleIsVisible:
    def test_the_note_title_reaches_the_cross_encoder(self, monkeypatch):
        seen: list[tuple[str, str]] = []
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))

        def fake_batch(session, tokenizer, pairs):
            seen.extend(pairs)
            return [1.0] * len(pairs)

        monkeypatch.setattr(rerank, "_score_batch", fake_batch)

        rerank.rerank_hits(
            "which house did we abandon",
            [hit("Personal/evertsenstraat-6-wormerveer.md", text="the ground sank")],
            1,
        )

        assert "evertsenstraat" in seen[0][1]
        assert "wormerveer" in seen[0][1]

    def test_the_chunk_text_is_still_there(self, monkeypatch):
        seen: list[tuple[str, str]] = []
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))

        def fake_batch(session, tokenizer, pairs):
            seen.extend(pairs)
            return [1.0] * len(pairs)

        monkeypatch.setattr(rerank, "_score_batch", fake_batch)

        rerank.rerank_hits("q", [hit("a/b.md", text="the ground was sinking")], 1)

        assert "the ground was sinking" in seen[0][1]


class TestFusedWithTheIncomingRanking:
    def test_a_disagreeing_reranker_cannot_dump_the_top_hit(self, monkeypatch):
        """Fusion says a, b, c and the cross-encoder says the exact opposite.
        Neither ranking has more claim than the other, so the hit fusion put
        first must not end up last. This is the regression that motivated the
        change: under pure replacement it went straight to the bottom.

        The two disagree symmetrically, so a and c tie. RRF's terms are
        harmonic, which makes a pair of extreme ranks sum higher than a pair of
        middling ones, so b placing second on both sides still finishes last.
        """
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))
        monkeypatch.setattr(
            rerank, "_score_batch", lambda s, t, pairs: [0.1, 0.5, 0.9]
        )

        out = rerank.rerank_hits("q", [hit("a.md"), hit("b.md"), hit("c.md")], 3)

        assert files(out)[-1] != "a.md"

    def test_a_strong_reranker_opinion_still_moves_a_hit(self, monkeypatch):
        """Six candidates, because rank distance is the only currency here and
        three positions cannot buy much. The reranker promotes c from third and
        demotes a from first, which is enough to change the top slot."""
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))
        monkeypatch.setattr(
            rerank,
            "_score_batch",
            lambda s, t, pairs: [0.1, 0.5, 0.9, 0.4, 0.3, 0.2],
        )

        out = rerank.rerank_hits(
            "q", [hit(f"{c}.md") for c in "abcdef"], 6
        )

        assert files(out)[0] == "c.md"

    def test_the_fusion_rank_is_read_from_the_incoming_order(self, monkeypatch):
        """The caller passes hits already ordered by fusion, so position in the
        input is the only record of what fusion decided."""
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))
        monkeypatch.setattr(
            rerank, "_score_batch", lambda s, t, pairs: [0.9, 0.1, 0.1]
        )

        out = rerank.rerank_hits("q", [hit("a.md"), hit("b.md"), hit("c.md")], 3)

        assert files(out)[0] == "a.md"

    def test_alpha_one_is_pure_reranking(self, monkeypatch):
        monkeypatch.setattr(rerank, "RERANK_ALPHA", 1.0)
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))
        monkeypatch.setattr(
            rerank, "_score_batch", lambda s, t, pairs: [0.1, 0.5, 0.9]
        )

        out = rerank.rerank_hits("q", [hit("a.md"), hit("b.md"), hit("c.md")], 3)

        assert files(out) == ["c.md", "b.md", "a.md"]

    def test_alpha_zero_leaves_the_fusion_order_alone(self, monkeypatch):
        monkeypatch.setattr(rerank, "RERANK_ALPHA", 0.0)
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))
        monkeypatch.setattr(
            rerank, "_score_batch", lambda s, t, pairs: [0.1, 0.5, 0.9]
        )

        out = rerank.rerank_hits("q", [hit("a.md"), hit("b.md"), hit("c.md")], 3)

        assert files(out) == ["a.md", "b.md", "c.md"]

    def test_penalties_still_apply(self, monkeypatch):
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))
        monkeypatch.setattr(
            rerank, "_score_batch", lambda s, t, pairs: [0.1, 0.2, 0.9]
        )

        out = rerank.rerank_hits(
            "q",
            [hit("a.md"), hit("b.md"), hit("c.md")],
            3,
            penalties={"c.md": 0.01},
        )

        assert files(out)[0] != "c.md"

    def test_prev_score_still_records_what_came_in(self, monkeypatch):
        """doctor.py reads this to tell a real rerank from a silent fallback."""
        monkeypatch.setattr(rerank, "_load", lambda: ("s", "t"))
        monkeypatch.setattr(rerank, "_score_batch", lambda s, t, pairs: [0.5, 0.1])

        out = rerank.rerank_hits("q", [hit("a.md", 0.42), hit("b.md", 0.11)], 2)

        assert {h["file"]: h["prev_score"] for h in out} == {"a.md": 0.42, "b.md": 0.11}
