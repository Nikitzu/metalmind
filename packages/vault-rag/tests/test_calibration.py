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

import pytest

from metalmind_vault_rag.calibration import (
    MIN_POSITIVE_SAMPLES,
    Bands,
    classify,
    derive_bands,
    embedder_id,
    percentile,
    read_sidecar,
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


class TestSidecarPath:
    def test_is_named_for_the_collection(self):
        assert sidecar_path("vault").name == "vault.calibration.json"

    def test_sits_beside_the_index_databases(self):
        assert sidecar_path("vault").parent.name == ".metalmind"
