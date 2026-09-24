"""Notes that changed while the watcher was stopped.

The watcher only hears about files that change while it runs. A note pulled by
git, written by another tool or deleted while it was down stayed wrong in the
index until it changed again, which on a machine where the watcher stops at
logout meant whole pulls went unindexed.
"""

import os

import pytest

from metalmind_vault_rag import watcher

WATERMARK = 1_000_000.0


def _note(vault, rel, mtime):
    path = vault / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("---\nkind: learning\n---\n# note\n")
    os.utime(path, (mtime, mtime))
    return path


@pytest.fixture
def vault(tmp_path, monkeypatch):
    root = tmp_path / "vault"
    root.mkdir()
    reindexed = []
    monkeypatch.setattr(watcher, "VAULT", root)
    monkeypatch.setattr(watcher, "files_to_index", lambda: sorted(root.rglob("*.md")))
    monkeypatch.setattr(watcher, "fts_written_at", lambda: WATERMARK)
    monkeypatch.setattr(watcher, "reindex_paths", lambda paths: reindexed.append(sorted(paths)))
    return root, reindexed


class TestCatchUp:
    def test_a_note_edited_after_the_last_index_write_is_reindexed(self, vault, monkeypatch):
        root, reindexed = vault
        _note(root, "Learnings/old.md", WATERMARK - 100)
        edited = _note(root, "Learnings/edited.md", WATERMARK + 100)
        monkeypatch.setattr(watcher, "fts_files", lambda: {"Learnings/old.md", "Learnings/edited.md"})

        watcher._catch_up()

        assert reindexed == [[edited]]

    def test_a_note_missing_from_the_index_is_indexed(self, vault, monkeypatch):
        root, reindexed = vault
        new = _note(root, "Work/new.md", WATERMARK - 100)
        monkeypatch.setattr(watcher, "fts_files", lambda: set())

        watcher._catch_up()

        assert reindexed == [[new]]

    def test_an_indexed_note_gone_from_disk_is_removed(self, vault, monkeypatch):
        root, reindexed = vault
        monkeypatch.setattr(watcher, "fts_files", lambda: {"Learnings/deleted.md"})

        watcher._catch_up()

        assert reindexed == [[root / "Learnings/deleted.md"]]

    def test_nothing_changed_means_no_indexing(self, vault, monkeypatch):
        root, reindexed = vault
        _note(root, "Learnings/old.md", WATERMARK - 100)
        monkeypatch.setattr(watcher, "fts_files", lambda: {"Learnings/old.md"})

        watcher._catch_up()

        assert reindexed == []

    def test_an_unreadable_index_skips_the_catch_up(self, vault, monkeypatch, capsys):
        root, reindexed = vault
        _note(root, "Learnings/old.md", WATERMARK + 100)

        def broken():
            raise RuntimeError("database is locked")

        monkeypatch.setattr(watcher, "fts_files", broken)

        watcher._catch_up()

        assert reindexed == []
        assert "catch-up" in capsys.readouterr().out
