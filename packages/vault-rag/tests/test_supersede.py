"""Supersede downweight + pointer in recall.

A note marked `status: superseded` re-ranks below current truth (0.4x on
the fused score, stacking with folder penalties) and every hit from it
carries `superseded_by: <stem>` so the reader can jump to the successor.
History is never hidden - only re-ranked and annotated.
"""

import os

from metalmind_vault_rag.search import _annotate_superseded, _rrf_merge


def hit(file: str, heading: str = "h", score: float = 1.0) -> dict:
    return {"file": file, "heading": heading, "score": score, "text": "t"}


class TestFusionPenalty:
    def test_superseded_note_drops_below_equal_active_note(self):
        smap = {"Plans/old-plan.md": "new-plan"}
        sem = [hit("Plans/old-plan.md"), hit("Plans/new-plan.md")]
        kw = [hit("Plans/new-plan.md"), hit("Plans/old-plan.md")]

        merged = _rrf_merge([sem, kw], k=5, supersede_map=smap)

        assert merged[0]["file"] == "Plans/new-plan.md"
        assert merged[1]["file"] == "Plans/old-plan.md"

    def test_penalty_scales_final_score(self):
        plain = _rrf_merge([[hit("Plans/a.md")]], k=1)[0]["score"]
        superseded = _rrf_merge(
            [[hit("Plans/a.md")]], k=1, supersede_map={"Plans/a.md": "b"}
        )[0]["score"]

        assert superseded == round(plain * 0.4, 4)

    def test_penalty_stacks_with_folder_penalty(self):
        plain = _rrf_merge([[hit("Work/a.md")]], k=1)[0]["score"]
        archived_superseded = _rrf_merge(
            [[hit("Archive/a.md")]], k=1, supersede_map={"Archive/a.md": "b"}
        )[0]["score"]

        assert archived_superseded == round(plain * 0.4 * 0.4, 4)

    def test_no_map_means_no_penalty(self):
        plain = _rrf_merge([[hit("Plans/a.md")]], k=1)[0]["score"]
        with_map = _rrf_merge(
            [[hit("Plans/a.md")]], k=1, supersede_map={"Plans/a.md": "b"}
        )[0]["score"]

        assert plain > with_map
        assert plain == _rrf_merge([[hit("Plans/a.md")]], k=1, supersede_map={})[0]["score"]


class TestAnnotation:
    def test_pointer_attached_to_superseded_hits(self):
        hits = [hit("Plans/old.md"), hit("Plans/new.md")]
        _annotate_superseded(hits, {"Plans/old.md": "new"})

        assert hits[0]["superseded_by"] == "new"
        assert "superseded_by" not in hits[1]

    def test_dangling_stem_passes_through_unmodified(self):
        hits = [hit("Plans/old.md")]
        _annotate_superseded(hits, {"Plans/old.md": "gone-note"})

        assert hits[0]["superseded_by"] == "gone-note"

    def test_status_without_pointer_penalises_but_does_not_annotate(self):
        hits = [hit("Plans/old.md")]
        _annotate_superseded(hits, {"Plans/old.md": ""})

        assert "superseded_by" not in hits[0]


class TestEnvOverride:
    def test_penalty_constant_drives_multiplier(self, monkeypatch):
        import metalmind_vault_rag.search as s

        monkeypatch.setattr(s, "SUPERSEDE_PENALTY", 0.5)
        plain = _rrf_merge([[hit("Plans/a.md")]], k=1)[0]["score"]
        superseded = _rrf_merge(
            [[hit("Plans/a.md")]], k=1, supersede_map={"Plans/a.md": "b"}
        )[0]["score"]

        assert superseded == round(plain * 0.5, 4)


class TestSupersedeIndex:
    def test_map_built_from_frontmatter(self, tmp_path, monkeypatch):
        import metalmind_vault_rag.core as core
        import metalmind_vault_rag.search as s

        (tmp_path / "Plans").mkdir()
        (tmp_path / "Plans" / "old.md").write_text(
            "---\nstatus: superseded\nsuperseded_by: new\n---\n\nbody\n"
        )
        (tmp_path / "Plans" / "new.md").write_text(
            "---\nstatus: active\nsupersedes: old\n---\n\nbody\n"
        )
        monkeypatch.setattr(core, "VAULT", tmp_path)
        monkeypatch.setattr(s, "VAULT", tmp_path)
        monkeypatch.setattr(s, "_SUPERSEDE_CACHE", None)
        monkeypatch.setattr(s, "_SUPERSEDE_KEY", None)

        smap = s._supersede_index()

        assert smap == {"Plans/old.md": "new"}

    def test_archived_superseded_note_stays_in_map(self, tmp_path, monkeypatch):
        import metalmind_vault_rag.core as core
        import metalmind_vault_rag.search as s

        (tmp_path / "Archive").mkdir()
        (tmp_path / "Archive" / "old.md").write_text(
            "---\nstatus: archived\nsuperseded_by: new\n---\n\nbody\n"
        )
        monkeypatch.setattr(core, "VAULT", tmp_path)
        monkeypatch.setattr(s, "VAULT", tmp_path)
        monkeypatch.setattr(s, "_SUPERSEDE_CACHE", None)
        monkeypatch.setattr(s, "_SUPERSEDE_KEY", None)

        assert s._supersede_index() == {"Archive/old.md": "new"}

    def test_quoted_pointer_and_next_line_status_handled(self, tmp_path, monkeypatch):
        import metalmind_vault_rag.core as core
        import metalmind_vault_rag.search as s

        (tmp_path / "Plans").mkdir()
        (tmp_path / "Plans" / "quoted.md").write_text(
            '---\nstatus: superseded\nsuperseded_by: "new-note"\n---\n\nbody\n'
        )
        (tmp_path / "Plans" / "split.md").write_text(
            "---\ntitle: x\nstatus:\n  superseded\n---\n\nbody\n"
        )
        monkeypatch.setattr(core, "VAULT", tmp_path)
        monkeypatch.setattr(s, "VAULT", tmp_path)
        monkeypatch.setattr(s, "_SUPERSEDE_CACHE", None)
        monkeypatch.setattr(s, "_SUPERSEDE_KEY", None)

        assert s._supersede_index() == {"Plans/quoted.md": "new-note"}

    def test_cache_hit_skips_file_reads(self, tmp_path, monkeypatch):
        import metalmind_vault_rag.core as core
        import metalmind_vault_rag.search as s

        (tmp_path / "Plans").mkdir()
        (tmp_path / "Plans" / "a.md").write_text(
            "---\nstatus: superseded\nsuperseded_by: b\n---\n\nbody\n"
        )
        monkeypatch.setattr(core, "VAULT", tmp_path)
        monkeypatch.setattr(s, "VAULT", tmp_path)
        monkeypatch.setattr(s, "_SUPERSEDE_CACHE", None)
        monkeypatch.setattr(s, "_SUPERSEDE_KEY", None)

        first = s._supersede_index()

        opens = []
        original_open = type(tmp_path).open
        monkeypatch.setattr(
            type(tmp_path), "open", lambda self, *a, **kw: opens.append(self) or original_open(self, *a, **kw)
        )

        assert s._supersede_index() is first
        assert opens == []

    def test_cache_invalidates_on_vault_change(self, tmp_path, monkeypatch):
        import metalmind_vault_rag.core as core
        import metalmind_vault_rag.search as s

        (tmp_path / "Plans").mkdir()
        note = tmp_path / "Plans" / "old.md"
        note.write_text("---\nstatus: active\n---\n\nbody\n")
        monkeypatch.setattr(core, "VAULT", tmp_path)
        monkeypatch.setattr(s, "VAULT", tmp_path)
        monkeypatch.setattr(s, "_SUPERSEDE_CACHE", None)
        monkeypatch.setattr(s, "_SUPERSEDE_KEY", None)

        assert s._supersede_index() == {}

        note.write_text("---\nstatus: superseded\nsuperseded_by: new\n---\n\nbody\n")
        os.utime(note, (note.stat().st_atime, note.stat().st_mtime + 10))

        assert s._supersede_index() == {"Plans/old.md": "new"}


class TestSearchVaultWiring:
    """The map must actually reach fusion, annotation, and the rerank path -
    unit tests on the private helpers alone leave the wiring deletable
    without a failure. Both MCP transports delegate to search_vault, so this
    also covers the both-paths payload requirement."""

    def _wire(self, monkeypatch, smap):
        import metalmind_vault_rag.search as s

        sem = [hit("Plans/old.md"), hit("Plans/new.md")]
        kw = [hit("Plans/new.md"), hit("Plans/old.md")]
        monkeypatch.setattr(s, "_semantic_search", lambda q, k: [dict(h) for h in sem])
        monkeypatch.setattr(s, "_keyword_search", lambda q, k: [dict(h) for h in kw])
        monkeypatch.setattr(s, "_supersede_index", lambda: smap)
        return s

    def test_hybrid_applies_penalty_and_pointer(self, monkeypatch):
        s = self._wire(monkeypatch, {"Plans/old.md": "new"})

        hits = s.search_vault("query", k=5)

        assert hits[0]["file"] == "Plans/new.md"
        assert hits[1]["file"] == "Plans/old.md"
        assert hits[1]["superseded_by"] == "new"
        assert "superseded_by" not in hits[0]

    def test_rerank_path_reapplies_penalty(self, monkeypatch):
        s = self._wire(monkeypatch, {"Plans/old.md": "new"})

        captured = {}

        def fake_rerank(query, hits, k, penalties=None):
            captured["penalties"] = penalties
            return list(hits)[:k]

        monkeypatch.setattr(s, "rerank_hits", fake_rerank)

        hits = s.search_vault("query", k=5, rerank=True)

        assert captured["penalties"] == {"Plans/old.md": s.SUPERSEDE_PENALTY}
        assert hits[1]["superseded_by"] == "new"
