"""What format an index was built in.

Nothing recorded this before, which was survivable only because the chunker had
never changed. The moment it does, an upgraded tool reads an old index and
returns quietly worse results with no signal that anything is wrong.

The stamp cannot be added retroactively either: an index built before it exists
carries no marker, so the window for making this identifiable closes the moment
compatibility is promised.
"""

import json

import pytest

from metalmind_vault_rag.index_format import (
    FORMAT_VERSION,
    IndexStamp,
    current_stamp,
    is_stale,
    read_built_at,
    read_stamp,
    stamp_path,
    write_stamp,
)

EMBEDDER = "BAAI/bge-small-en-v1.5@384"


class TestCurrentStamp:
    def test_records_the_running_format(self):
        stamp = current_stamp(embedder=EMBEDDER, files=341, chunks=2970)

        assert stamp.format_version == FORMAT_VERSION
        assert stamp.embedder == EMBEDDER

    def test_carries_the_counts_it_was_given(self):
        stamp = current_stamp(embedder=EMBEDDER, files=341, chunks=2970)

        assert (stamp.files, stamp.chunks) == (341, 2970)

    def test_describes_the_chunker_for_a_human_reader(self):
        stamp = current_stamp(embedder=EMBEDDER, files=1, chunks=1)

        assert stamp.chunker
        assert stamp.embedded_text
        assert stamp.max_chunk_chars > 0


class TestStaleness:
    def test_matching_version_and_embedder_is_fresh(self):
        assert not is_stale(current_stamp(embedder=EMBEDDER, files=1, chunks=1), EMBEDDER)

    def test_an_older_format_is_stale(self):
        old = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        old = IndexStamp(**{**old.__dict__, "format_version": FORMAT_VERSION - 1})

        assert is_stale(old, EMBEDDER)

    def test_a_newer_format_is_stale_too(self):
        newer = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        newer = IndexStamp(**{**newer.__dict__, "format_version": FORMAT_VERSION + 1})

        assert is_stale(newer, EMBEDDER)

    def test_a_different_embedder_is_stale(self):
        stamp = current_stamp(embedder=EMBEDDER, files=1, chunks=1)

        assert is_stale(stamp, "nomic-embed-text@768")

    def test_a_missing_stamp_is_not_stale(self):
        """An index with no stamp predates stamping, and this release still
        builds what it built. Calling that stale would tell every existing
        install to rebuild for nothing."""
        assert not is_stale(None, EMBEDDER)

    def test_counts_do_not_decide_staleness(self):
        stamp = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        grown = IndexStamp(**{**stamp.__dict__, "files": 900, "chunks": 9000})
        emptied = IndexStamp(**{**stamp.__dict__, "files": 0, "chunks": 0})

        assert not is_stale(grown, EMBEDDER)
        assert not is_stale(emptied, EMBEDDER)

    def test_chunker_parameters_alone_do_not_decide_staleness(self):
        """The descriptive fields are for a human reading the file. Changing one
        without bumping FORMAT_VERSION is the mistake this documents, not a
        second detection path."""
        stamp = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        retuned = IndexStamp(**{**stamp.__dict__, "max_chunk_chars": 1200})

        assert not is_stale(retuned, EMBEDDER)


class TestPersistence:
    def test_round_trips(self, tmp_path):
        path = tmp_path / "vault.index.json"
        stamp = current_stamp(embedder=EMBEDDER, files=341, chunks=2970)

        write_stamp(path, stamp)

        assert read_stamp(path) == stamp

    def test_absent_file_reads_as_none(self, tmp_path):
        assert read_stamp(tmp_path / "missing.json") is None

    def test_corrupt_file_reads_as_none(self, tmp_path):
        path = tmp_path / "vault.index.json"
        path.write_text("{not json", encoding="utf-8")

        assert read_stamp(path) is None

    def test_a_stamp_missing_fields_reads_as_none(self, tmp_path):
        path = tmp_path / "vault.index.json"
        path.write_text(json.dumps({"format_version": 1}), encoding="utf-8")

        assert read_stamp(path) is None

    def test_records_when_it_was_built(self, tmp_path):
        path = tmp_path / "vault.index.json"

        write_stamp(path, current_stamp(embedder=EMBEDDER, files=1, chunks=1))
        payload = json.loads(path.read_text(encoding="utf-8"))

        assert payload["built_at"]

    def test_a_future_stamp_still_reads_so_it_can_be_reported_stale(self, tmp_path):
        """Unlike the calibration sidecar, an unrecognised stamp must survive
        reading. Treating it as absent would report a downgraded install as
        never stamped rather than as mismatched."""
        path = tmp_path / "vault.index.json"
        stamp = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        write_stamp(path, IndexStamp(**{**stamp.__dict__, "format_version": FORMAT_VERSION + 5}))

        loaded = read_stamp(path)

        assert loaded is not None
        assert is_stale(loaded, EMBEDDER)


class TestStampPath:
    def test_is_named_for_the_collection(self):
        assert stamp_path("vault").name == "vault.index.json"

    def test_sits_beside_the_index_databases(self):
        assert stamp_path("vault").parent.name == ".metalmind"

    def test_does_not_collide_with_the_calibration_sidecar(self):
        from metalmind_vault_rag.calibration import sidecar_path

        assert stamp_path("vault") != sidecar_path("vault")


class TestBuiltAt:
    def test_reports_when_the_stamp_was_written(self, tmp_path):
        path = tmp_path / "vault.index.json"
        write_stamp(path, current_stamp(embedder=EMBEDDER, files=1, chunks=1))

        assert read_built_at(path)

    def test_absent_file_has_no_timestamp(self, tmp_path):
        assert read_built_at(tmp_path / "missing.json") is None

    def test_a_stamp_written_without_one_reads_as_none(self, tmp_path):
        path = tmp_path / "vault.index.json"
        path.write_text(json.dumps({"format_version": 1}), encoding="utf-8")

        assert read_built_at(path) is None

    def test_it_is_not_part_of_stamp_equality(self, tmp_path):
        """Two indexes built in the same format are the same format. Folding the
        clock into that comparison would make every stamp unique."""
        a, b = tmp_path / "a.json", tmp_path / "b.json"
        write_stamp(a, current_stamp(embedder=EMBEDDER, files=1, chunks=1))
        write_stamp(b, current_stamp(embedder=EMBEDDER, files=1, chunks=1))

        assert read_stamp(a) == read_stamp(b)
