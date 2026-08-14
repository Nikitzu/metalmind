"""Per-vault confidence band derivation.

Fusion discards score magnitude, so the fused score cannot tell a bullseye from
the least-bad of a bad set. Raw cosine can: on a 330-note vault it separates
answerable from unanswerable questions at AUC 0.984. The threshold that
exploits it is corpus-shaped, though, so it is derived per vault rather than
shipped as a constant.

These tests cover the arithmetic and the refusal paths only. Sampling and the
indexer hook live elsewhere.
"""

import json
import random
import re

import pytest

from metalmind_vault_rag.calibration import (
    MIN_POSITIVE_SAMPLES,
    NEAR_MISS_COUNT,
    NEAR_MISS_HIGH_TOLERANCE,
    OUT_OF_DOMAIN_COUNT,
    Bands,
    classify,
    derive_bands,
    EXCERPT_WORDS,
    MAX_EXCERPT_SAMPLES,
    MIN_QUERY_WORDS,
    embedder_id,
    excerpt_query,
    load_near_miss,
    load_probes,
    percentile,
    read_sidecar,
    sample_excerpt_queries,
    sidecar_path,
    write_sidecar,
)


def positives(n=MIN_POSITIVE_SAMPLES, base=0.70):
    return [base + (i % 20) / 100 for i in range(n)]


def probes(n=100, base=0.40):
    return [base + (i % 20) / 100 for i in range(n)]


class TestPercentile:
    def test_empty_is_zero(self):
        assert percentile([], 50) == 0.0

    def test_single_value(self):
        assert percentile([0.5], 10) == 0.5

    def test_picks_by_nearest_rank(self):
        values = [float(i) for i in range(101)]
        assert percentile(values, 0) == 0.0
        assert percentile(values, 50) == 50.0
        assert percentile(values, 100) == 100.0

    def test_does_not_require_presorted_input(self):
        assert percentile([0.9, 0.1, 0.5], 50) == 0.5


class TestDeriveBands:
    def test_separated_distributions_produce_bands(self):
        bands = derive_bands(positives(), probes())

        assert bands is not None
        assert bands.high_edge < bands.low_edge

    def test_low_edge_is_p10_of_positives(self):
        scores = [i / 100 for i in range(100)]

        bands = derive_bands(scores, [0.0] * 100)

        assert bands is not None
        assert bands.low_edge == pytest.approx(percentile(scores, 10))

    def test_high_edge_is_p95_of_probes(self):
        probe_scores = [i / 1000 for i in range(100)]

        bands = derive_bands(positives(), probe_scores)

        assert bands is not None
        assert bands.high_edge == pytest.approx(percentile(probe_scores, 95))

    def test_refuses_below_the_minimum_sample(self):
        assert derive_bands(positives(MIN_POSITIVE_SAMPLES - 1), probes()) is None

    def test_refuses_without_probes(self):
        assert derive_bands(positives(), []) is None

    def test_refuses_when_the_classes_do_not_separate(self):
        overlapping = [0.5] * 100

        assert derive_bands(positives(base=0.30), overlapping) is None


class TestClassify:
    bands = Bands(low_edge=0.70, high_edge=0.64)

    def test_at_or_above_the_low_edge_is_high(self):
        assert classify(0.70, self.bands) == "high"
        assert classify(0.99, self.bands) == "high"

    def test_below_the_high_edge_is_low(self):
        assert classify(0.63, self.bands) == "low"
        assert classify(0.0, self.bands) == "low"

    def test_between_the_edges_is_medium(self):
        assert classify(0.64, self.bands) == "medium"
        assert classify(0.69, self.bands) == "medium"

    def test_a_missing_score_is_low(self):
        assert classify(None, self.bands) == "low"


class TestSidecar:
    def test_round_trips(self, tmp_path):
        path = tmp_path / "c.json"
        bands = Bands(low_edge=0.6983, high_edge=0.6779)

        write_sidecar(path, bands, embedder="m@384", positives_n=150, probes_n=100)

        assert read_sidecar(path, embedder="m@384") == bands

    def test_absent_file_reads_as_none(self, tmp_path):
        assert read_sidecar(tmp_path / "missing.json", embedder="m@384") is None

    def test_corrupt_file_reads_as_none(self, tmp_path):
        path = tmp_path / "c.json"
        path.write_text("{not json", encoding="utf-8")

        assert read_sidecar(path, embedder="m@384") is None

    def test_embedder_mismatch_reads_as_none(self, tmp_path):
        path = tmp_path / "c.json"
        write_sidecar(path, Bands(0.70, 0.64), embedder="old@384", positives_n=150, probes_n=100)

        assert read_sidecar(path, embedder="new@768") is None

    def test_records_provenance(self, tmp_path):
        path = tmp_path / "c.json"

        write_sidecar(path, Bands(0.70, 0.64), embedder="m@384", positives_n=150, probes_n=100)
        payload = json.loads(path.read_text(encoding="utf-8"))

        assert payload["embedder"] == "m@384"
        assert payload["positives_n"] == 150
        assert payload["probes_n"] == 100
        assert payload["generated_at"]

    def test_future_version_reads_as_none(self, tmp_path):
        path = tmp_path / "c.json"
        write_sidecar(path, Bands(0.70, 0.64), embedder="m@384", positives_n=150, probes_n=100)
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["version"] += 1
        path.write_text(json.dumps(payload), encoding="utf-8")

        assert read_sidecar(path, embedder="m@384") is None


class TestEmbedderId:
    def test_combines_model_and_dimension(self):
        assert embedder_id("BAAI/bge-small-en-v1.5", 384) == "BAAI/bge-small-en-v1.5@384"

    def test_a_dimension_change_alone_changes_the_id(self):
        assert embedder_id("m", 384) != embedder_id("m", 768)


FIRST_PERSON = re.compile(r"\b(I|I'm|I've|my|me|mine)\b", re.IGNORECASE)

CAPITALS_WITHOUT_SIGNAL = {
    "I",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
}


def invented_nouns(probe: str) -> list[str]:
    """Capitalised tokens past the first word, minus the ones that are
    capitalised for grammar rather than because they name something."""
    tokens = probe.split()
    return [
        t.strip(".,?'s")
        for i, t in enumerate(tokens)
        if i > 0 and t[:1].isupper() and t.strip(".,?'s") not in CAPITALS_WITHOUT_SIGNAL
    ]


class TestProbes:
    def test_ships_the_declared_counts(self):
        assert len(load_probes()) == OUT_OF_DOMAIN_COUNT
        assert len(load_near_miss()) == NEAR_MISS_COUNT

    def test_the_two_sets_are_disjoint(self):
        assert not set(load_probes()) & set(load_near_miss())

    def test_all_unique(self):
        every = load_probes() + load_near_miss()

        assert len(set(every)) == len(every)

    def test_none_empty_or_rambling(self):
        for p in load_probes() + load_near_miss():
            assert 4 <= len(p.split()) <= 30, p

    def test_every_probe_asks_about_the_asker(self):
        for p in load_probes() + load_near_miss():
            assert FIRST_PERSON.search(p), p

    def test_every_probe_carries_a_proper_noun(self):
        for p in load_probes() + load_near_miss():
            assert invented_nouns(p), p

    def test_no_single_proper_noun_dominates(self):
        counts = {}
        for p in load_probes() + load_near_miss():
            for noun in set(invented_nouns(p)):
                counts[noun] = counts.get(noun, 0) + 1

        worst = max(counts.items(), key=lambda kv: kv[1])
        assert worst[1] <= 3, f"{worst[0]} appears in {worst[1]} probes"

    def test_returns_a_copy_so_callers_cannot_corrupt_the_fixture(self):
        load_probes().append("mutated")
        load_near_miss().append("mutated")

        assert len(load_probes()) == OUT_OF_DOMAIN_COUNT
        assert len(load_near_miss()) == NEAR_MISS_COUNT


class TestNearMissGuard:
    """Near-miss probes are held out of edge derivation and used to catch an
    over-confident band. They are unanswerable, so any that land in `high` are
    cases where the tool would claim confidence about absent content."""

    def test_bands_survive_a_tolerable_near_miss_rate(self):
        scores = [i / 100 for i in range(100)]
        near = [0.0] * 9 + [0.99]

        assert derive_bands(scores, [0.0] * 100, near) is not None

    def test_refuses_when_most_near_misses_read_as_high(self):
        scores = [i / 100 for i in range(100)]
        near = [0.99] * 10

        assert derive_bands(scores, [0.0] * 100, near) is None

    def test_the_guard_is_skipped_without_a_near_miss_sample(self):
        scores = [i / 100 for i in range(100)]

        assert derive_bands(scores, [0.0] * 100, []) is not None

    def test_tolerance_is_a_real_fraction(self):
        assert 0 < NEAR_MISS_HIGH_TOLERANCE <= 1


class TestSidecarPath:
    def test_is_named_for_the_collection(self):
        assert sidecar_path("vault").name == "vault.calibration.json"

    def test_sits_beside_the_index_databases(self):
        assert sidecar_path("vault").parent.name == ".metalmind"


SENTENCE = (
    "The watcher reopens its connection whenever the journal mode changes "
    "underneath it during a long running rebuild of the collection."
)


def rows(n, prefix="Notes/topic"):
    """Each row carries a distinct leading token. Prose that repeats across
    rows makes the sample look seed-independent even when sampling is correct,
    and a difference confined to a short lead-in sentence is dropped by the
    sentence-length floor before it can vary anything."""
    return [
        (
            f"{prefix}-{i}.md",
            f"Alphaword{i} reopens its connection whenever the journal mode "
            "changes underneath it during a long running rebuild.",
        )
        for i in range(n)
    ]


class TestExcerptQuery:
    def test_builds_a_query_from_the_body(self):
        q = excerpt_query(SENTENCE, "Notes/watcher.md", random.Random(1))

        assert q
        assert len(q.split()) <= EXCERPT_WORDS

    def test_strips_tokens_that_appear_in_the_path(self):
        q = excerpt_query(SENTENCE, "Notes/watcher-journal-collection.md", random.Random(1))

        assert q
        for leaked in ("watcher", "journal", "collection"):
            assert leaked not in q.lower().split()

    def test_rejects_text_too_short_to_ask_about(self):
        assert excerpt_query("Too short.", "a.md", random.Random(1)) is None

    def test_rejects_when_stripping_leaves_too_little(self):
        text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu"

        assert excerpt_query(text, "alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota-kappa.md", random.Random(1)) is None

    def test_rejects_sentences_below_the_length_floor(self):
        """Nine words clears the query floor but not the sentence floor. A
        fragment that short is not a question anyone would ask, and without the
        sentence floor it would become one."""
        text = "One two three four five six seven eight nine. Ten eleven twelve."

        assert excerpt_query(text, "a.md", random.Random(1)) is None

    def test_skips_headings_tables_and_fences(self):
        text = "# " + SENTENCE + "\n| " + SENTENCE + "\n> " + SENTENCE

        assert excerpt_query(text, "a.md", random.Random(1)) is None


class TestSampleExcerptQueries:
    def test_is_deterministic_under_a_fixed_seed(self):
        first = sample_excerpt_queries(rows(40), limit=10, seed=7)
        second = sample_excerpt_queries(rows(40), limit=10, seed=7)

        assert first == second

    def test_a_different_seed_samples_differently(self):
        many = rows(200)

        assert sample_excerpt_queries(many, limit=20, seed=1) != sample_excerpt_queries(many, limit=20, seed=2)

    def test_respects_the_limit(self):
        assert len(sample_excerpt_queries(rows(500), limit=25, seed=1)) == 25

    def test_returns_empty_for_an_empty_index(self):
        assert sample_excerpt_queries([], limit=10, seed=1) == []

    def test_skips_rows_that_yield_nothing(self):
        usable = rows(5)
        junk = [("x.md", "tiny") for _ in range(50)]

        assert len(sample_excerpt_queries(junk + usable, limit=10, seed=1)) == 5

    def test_every_query_clears_the_word_floor(self):
        for q in sample_excerpt_queries(rows(30), limit=30, seed=3):
            assert len(q.split()) >= MIN_QUERY_WORDS

    def test_default_limit_matches_the_documented_sample_size(self):
        assert MAX_EXCERPT_SAMPLES == 150
