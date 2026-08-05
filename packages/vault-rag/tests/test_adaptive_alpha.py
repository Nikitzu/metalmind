"""Adaptive fusion weighting (Dynamic Alpha Tuning, Hsu et al. 2025).

Queries carrying exact-match signals (UUIDs, numeric IDs, ticket IDs,
hostnames, emails) get a raised keyword weight in RRF fusion; prose
queries keep the balanced defaults.
"""

import pytest

from metalmind_vault_rag import search as s


class TestExactSignal:
    @pytest.mark.parametrize(
        "query",
        [
            "error for request 550e8400-e29b-41d4-a716-446655440000",
            "what happened to booking 48213975",
            "RED-991 penalty toggle decision",
            "logs from api.transferz.com yesterday",
            "who is test-mz@proton.me",
        ],
    )
    def test_detects_exact_match_signals(self, query):
        assert s._exact_signal(query) is True

    @pytest.mark.parametrize(
        "query",
        [
            "how does the watcher reindex notes",
            "decision about folder penalties",
            "top 3 risks",
            "plan for v0.9",
        ],
    )
    def test_prose_queries_stay_balanced(self, query):
        assert s._exact_signal(query) is False


class TestFusionWeights:
    def test_prose_query_uses_default_weights(self):
        assert s._fusion_weights("how does reindexing work") == [
            s.SEMANTIC_WEIGHT,
            s.KEYWORD_WEIGHT,
        ]

    def test_exact_query_raises_keyword_weight(self):
        weights = s._fusion_weights("booking 48213975 failed")
        assert weights[0] == s.SEMANTIC_WEIGHT
        assert weights[1] == s.KEYWORD_WEIGHT_EXACT
        assert weights[1] > s.KEYWORD_WEIGHT

    def test_adaptive_toggle_off_restores_fixed_weights(self, monkeypatch):
        monkeypatch.setattr(s, "ADAPTIVE_FUSION", False)
        assert s._fusion_weights("booking 48213975 failed") == [
            s.SEMANTIC_WEIGHT,
            s.KEYWORD_WEIGHT,
        ]
