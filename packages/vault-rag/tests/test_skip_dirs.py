"""Skip-dir filtering: .trash (scribe soft-delete target), .obsidian, and
.metalmind-stack must never be indexed. Regression for trashed notes
outranking live ones in recall after a scribe delete."""

from __future__ import annotations

from pathlib import Path, PurePath

from metalmind_vault_rag.core import SKIP_DIRS, in_skip_dir
from metalmind_vault_rag.watcher import _md_change


def test_skip_dirs_cover_trash() -> None:
    assert ".trash" in SKIP_DIRS


def test_in_skip_dir_matches_any_path_segment() -> None:
    assert in_skip_dir(PurePath(".trash/2026-07-19__note.md"))
    assert in_skip_dir(PurePath("/vault/.trash/nested/deep.md"))
    assert in_skip_dir(PurePath(".obsidian/workspace.md"))
    assert not in_skip_dir(PurePath("Plans/2026-07-19-topic.md"))
    assert not in_skip_dir(PurePath("Learnings/trash-handling-notes.md"))


def test_md_change_ignores_trash_moves() -> None:
    assert not _md_change("/vault/.trash/2026-07-19__note.md")
    assert not _md_change("/vault/.obsidian/anything.md")
    assert not _md_change("/vault/Plans/live-note.txt")
    assert _md_change("/vault/Plans/live-note.md")
