"""Folder penalty multipliers in RRF fusion.

Archived plans and unsorted inbox notes should not outrank in-flight work
notes with comparable relevance. Fusion downweights them: 0.4x for Archive/,
0.7x for Inbox/, 1.0x everywhere else.
"""

from metalmind_vault_rag.search import _folder_multiplier, _rrf_merge


def hit(file: str, heading: str = "h", score: float = 1.0) -> dict:
    return {"file": file, "heading": heading, "score": score, "text": "t"}


class TestFolderMultiplier:
    def test_archive_is_heavily_penalised(self):
        assert _folder_multiplier("Archive/Plans/old-plan.md") == 0.4

    def test_inbox_is_lightly_penalised(self):
        assert _folder_multiplier("Inbox/clipping.md") == 0.7

    def test_other_folders_untouched(self):
        assert _folder_multiplier("Work/current.md") == 1.0
        assert _folder_multiplier("Plans/active.md") == 1.0
        assert _folder_multiplier("Daily/2026-08-05.md") == 1.0

    def test_only_top_level_prefix_counts(self):
        assert _folder_multiplier("Work/Archive-notes.md") == 1.0
        assert _folder_multiplier("Work/Inbox/nested.md") == 1.0


class TestFusionAppliesPenalty:
    def test_archived_note_drops_below_equal_active_note(self):
        sem = [hit("Archive/Plans/shipped.md"), hit("Work/in-flight.md")]
        kw = [hit("Work/in-flight.md"), hit("Archive/Plans/shipped.md")]

        merged = _rrf_merge([sem, kw], k=5)

        assert merged[0]["file"] == "Work/in-flight.md"
        assert merged[1]["file"] == "Archive/Plans/shipped.md"

    def test_penalty_scales_final_score(self):
        plain = _rrf_merge([[hit("Work/a.md")]], k=1)[0]["score"]
        archived = _rrf_merge([[hit("Archive/a.md")]], k=1)[0]["score"]
        inbox = _rrf_merge([[hit("Inbox/a.md")]], k=1)[0]["score"]

        assert archived == round(plain * 0.4, 4)
        assert inbox == round(plain * 0.7, 4)

    def test_penalty_reranks_but_does_not_exclude(self):
        sem = [hit("Archive/decisive.md")] + [hit(f"Work/n{i}.md") for i in range(9)] + [
            hit("Work/weak.md")
        ]
        kw = list(sem)

        merged = _rrf_merge([sem, kw], k=11)

        files = [h["file"] for h in merged]
        assert files.index("Archive/decisive.md") < files.index("Work/weak.md")
