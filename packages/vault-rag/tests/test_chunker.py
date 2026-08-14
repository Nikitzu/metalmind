"""Splitting a section into chunks.

The old chunker cut at a fixed character offset, mid-word, with no overlap: a
fact spanning the cut existed intact in neither chunk. This splits on sentence
boundaries and carries a little of the previous chunk forward.

Overlap introduces a hazard the fixed cut did not have. If the carried tail is
large enough to fill the next chunk on its own, packing makes no progress and
loops forever, so every chunk must contain at least one segment that is new.
"""

import pytest

from metalmind_vault_rag.core import chunk_markdown, split_section

SENTENCE = "This sentence carries roughly sixty characters of ordinary prose."


def section(n):
    """Each sentence ends differently. Repetitive tails make an overlap
    assertion pass whether or not anything was carried, which is how the first
    version of this file failed to catch overlap being removed entirely."""
    return " ".join(f"{SENTENCE} Distinct tail marker {i}." for i in range(n))


class TestBoundaries:
    def test_short_text_is_one_chunk(self):
        assert split_section("One short sentence.", target=1200, overlap=200) == ["One short sentence."]

    def test_empty_text_yields_nothing(self):
        assert split_section("   ", target=1200, overlap=200) == []

    def test_it_never_cuts_mid_word(self):
        for chunk in split_section(section(60), target=400, overlap=80):
            assert not chunk.startswith(" ")
            assert chunk == chunk.strip()
            words = chunk.split()
            assert all(w for w in words)

    def test_every_sentence_survives_somewhere(self):
        text = " ".join(f"Fact number {i} is worth keeping." for i in range(40))

        chunks = split_section(text, target=300, overlap=60)

        for i in range(40):
            assert any(f"Fact number {i} is worth keeping." in c for c in chunks)

    def test_paragraph_breaks_are_boundaries(self):
        text = "First para line.\n\nSecond para line."

        chunks = split_section(text, target=25, overlap=0)

        assert len(chunks) == 2


class TestOverlap:
    def test_consecutive_chunks_share_content(self):
        chunks = split_section(section(40), target=400, overlap=150)

        assert len(chunks) > 1
        marker = chunks[0].split()[-1]
        assert marker in chunks[1]

    def test_zero_overlap_shares_nothing(self):
        chunks = split_section(section(40), target=400, overlap=0)

        assert len(chunks) > 1
        assert chunks[0].split()[-1] not in chunks[1]

    def test_packing_always_advances(self):
        """An overlap at or above the target would refill each chunk from the
        carried tail alone and never consume a new segment."""
        chunks = split_section(section(30), target=200, overlap=10_000)

        assert len(chunks) >= 1
        assert len(chunks) < 200


class TestOversizedSentences:
    def test_a_sentence_longer_than_the_target_is_emitted_whole(self):
        monster = "word " * 400 + "end."

        chunks = split_section(monster, target=200, overlap=50)

        assert any(c.strip().endswith("end.") for c in chunks)
        assert any(len(c) > 200 for c in chunks)

    def test_it_is_not_split_across_chunks(self):
        monster = "a" * 900 + "."

        chunks = split_section(monster, target=200, overlap=50)

        assert any("a" * 900 in c for c in chunks)


class TestChunkMarkdown:
    def test_sections_still_carry_their_heading_path(self):
        text = "# Note\n\n## Body\n\n" + section(40)

        chunks = chunk_markdown(text)

        assert all(hp == "Note / Body" for hp, _ in chunks)

    def test_a_long_section_produces_several_chunks(self):
        text = "# Note\n\n## Body\n\n" + section(200)

        chunks = chunk_markdown(text)

        assert len(chunks) > 1

    def test_a_short_note_is_untouched(self):
        chunks = chunk_markdown("# Note\n\n## Body\n\nShort.")

        assert chunks == [("Note / Body", "Short.")]


class TestOverlapClamp:
    def test_an_overlap_above_the_target_does_not_balloon_the_chunks(self):
        """Unclamped, overlap 1000 against target 200 produced chunks of 1069
        characters and four times the count. It terminated, which is what made
        it dangerous: a mistyped sweep value would build a quietly bad index."""
        text = " ".join(f"Sentence {i} of ordinary prose here." for i in range(30))

        chunks = split_section(text, target=200, overlap=10_000)

        assert max(len(c) for c in chunks) < 400

    def test_clamping_matches_a_sane_overlap(self):
        text = " ".join(f"Sentence {i} of ordinary prose here." for i in range(30))

        assert split_section(text, 200, 10_000) == split_section(text, 200, 100)

    def test_a_negative_overlap_is_treated_as_none(self):
        text = " ".join(f"Sentence {i} of ordinary prose here." for i in range(30))

        assert split_section(text, 200, -50) == split_section(text, 200, 0)


class TestOversizeCeiling:
    def test_content_with_no_sentence_boundary_is_still_broken_up(self):
        """The embedder truncates at its token limit, so a single enormous chunk
        leaves everything past the limit unindexed. A base64 blob or a wide
        table has no boundary to split on, and there the old character cut is
        the lesser harm."""
        from metalmind_vault_rag.core import MAX_CHUNK_CHARS

        blob = "x" * (MAX_CHUNK_CHARS * 2 + 100)

        chunks = split_section(blob, target=1200, overlap=200)

        assert len(chunks) >= 3

    def test_a_merely_long_sentence_is_still_kept_whole(self):
        text = "word " * 300 + "end."

        chunks = split_section(text, target=200, overlap=50)

        assert any(c.strip().endswith("end.") and len(c) > 200 for c in chunks)
