"""Whole-vault staleness sweep (`vault-doctor --stale`).

Report-only: lists notes untouched past the window, outside Archive/ and
Daily/, and marks ones that never appeared in the recall log's top hits.
Distinguishes "log disabled" (no marker possible) from "never recalled".
"""

import json
import os
import time

import pytest

from metalmind_vault_rag import doctor, recall_log


def write_note(vault, rel, age_days):
    path = vault / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("body\n", encoding="utf-8")
    old = time.time() - age_days * 86400
    os.utime(path, (old, old))
    return path


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.setattr(doctor, "VAULT", tmp_path)
    return tmp_path


class TestCollectStaleVault:
    def test_old_note_is_listed_with_age(self, vault):
        write_note(vault, "Work/old.md", 120)
        write_note(vault, "Work/fresh.md", 3)

        entries = doctor.collect_stale_vault(days=90)

        assert [(rel, age >= 119) for age, rel, _ in entries] == [("Work/old.md", True)]

    def test_archive_and_daily_are_skipped(self, vault):
        write_note(vault, "Archive/ancient.md", 400)
        write_note(vault, "Daily/2025-01-01.md", 400)
        write_note(vault, "Learnings/kept.md", 400)

        entries = doctor.collect_stale_vault(days=90)

        assert [rel for _, rel, _ in entries] == ["Learnings/kept.md"]

    def test_hidden_dirs_are_skipped(self, vault):
        write_note(vault, ".obsidian/workspace.md", 400)
        write_note(vault, ".trash/gone.md", 400)

        assert doctor.collect_stale_vault(days=90) == []

    def test_never_recalled_marker_requires_a_log(self, vault):
        write_note(vault, "Work/old.md", 120)

        without_log = doctor.collect_stale_vault(days=90, recalled=None)
        with_log = doctor.collect_stale_vault(days=90, recalled={"Work/other.md"})
        recalled = doctor.collect_stale_vault(days=90, recalled={"Work/old.md"})

        assert without_log[0][2] is False
        assert with_log[0][2] is True
        assert recalled[0][2] is False


class TestRecalledFilesFromLog:
    def test_disabled_log_returns_none(self, monkeypatch):
        monkeypatch.setattr(recall_log, "log_path", lambda: None)
        assert doctor.recalled_files_from_log() is None

    def test_reads_top_files_and_skips_malformed_lines(self, tmp_path, monkeypatch):
        log = tmp_path / "recall.ndjson"
        lines = [
            json.dumps({"ts": "2026-08-01T00:00:00Z", "top_files": ["Work/a.md", "Work/b.md"]}),
            "not json",
            json.dumps({"ts": "2026-08-02T00:00:00Z", "top_files": ["Work/a.md"]}),
        ]
        log.write_text("\n".join(lines) + "\n", encoding="utf-8")
        monkeypatch.setattr(recall_log, "log_path", lambda: log)

        assert doctor.recalled_files_from_log() == {"Work/a.md", "Work/b.md"}
