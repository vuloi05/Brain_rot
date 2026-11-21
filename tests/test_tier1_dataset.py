"""Tier 1 & Tier 2 Dataset Validation Tests (F2: data/en-readings.json, T1-F2-01..05 & T2-F2-01..05)."""

from __future__ import annotations

import json
import re
import unittest
from collections import Counter

from playwright.sync_api import expect

from tests.harness import (
    BrowserManager,
    EN_ROOTS_PATH,
    EN_VOCAB_PATH,
    IsolatedServer,
    PlaywrightSession,
    capture_progress_snapshot,
    require_en_readings_dataset,
)

CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1")
EXPECTED_THEMES = ("deep focus", "brain science", "psychology", "linguistics")

_BROWSER_MGR = BrowserManager()


def tearDownModule() -> None:
    _BROWSER_MGR.close()


class TestDatasetTier1And2(unittest.TestCase):
    """T1-F2-01..05 & T2-F2-01..05 covering data/en-readings.json contract and CEFR UI list."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.snapshot = capture_progress_snapshot()
        cls.roots_data = json.loads(EN_ROOTS_PATH.read_text(encoding="utf-8"))
        roots_list = cls.roots_data["roots"] if isinstance(cls.roots_data, dict) else cls.roots_data
        cls.valid_root_ids = {r["id"] for r in roots_list}
        cls.vocab_data = json.loads(EN_VOCAB_PATH.read_text(encoding="utf-8"))
        cls.core_words = {item["w"].strip().lower() for item in cls.vocab_data if item.get("w")}

    def _load_readings_via_http(self, srv: IsolatedServer) -> list[dict]:
        require_en_readings_dataset()
        status, raw = srv.request("/data/en-readings.json", method="GET")
        self.assertEqual(status, 200, "GET /data/en-readings.json must return HTTP 200")
        parsed = json.loads(raw.decode("utf-8"))
        self.assertIsInstance(parsed, list, "data/en-readings.json must be a JSON array")
        return parsed

    def test_t1_f2_01_valid_json_array_length_15(self) -> None:
        """T1-F2-01: GET /data/en-readings.json returns valid JSON array of exact length 15."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            self.assertEqual(len(articles), 15)

    def test_t1_f2_02_three_articles_per_cefr_and_unique_ids(self) -> None:
        """T1-F2-02: Exactly 3 articles each for A1, A2, B1, B2, C1 and all ids unique."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            counts = Counter(a.get("level") for a in articles)
            for lvl in CEFR_LEVELS:
                self.assertEqual(counts[lvl], 3, f"Expected 3 articles for {lvl}, got {counts[lvl]}")
            ids = [a.get("id") for a in articles]
            self.assertEqual(len(ids), len(set(ids)), "Duplicate article ids detected")

    def test_t1_f2_03_article_and_nested_schema(self) -> None:
        """T1-F2-03: Every article satisfies id, level, title, source, category, paragraphs, question schema."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            for idx, art in enumerate(articles):
                for field in ("id", "level", "title", "source", "category"):
                    val = art.get(field)
                    self.assertIsInstance(val, str, f"Article #{idx} '{field}' must be str")
                    self.assertTrue(val.strip(), f"Article #{idx} '{field}' must be non-empty")

                paras = art.get("paragraphs")
                self.assertIsInstance(paras, list, f"Article {art['id']} paragraphs must be list")
                self.assertGreater(len(paras), 0, f"Article {art['id']} paragraphs must be non-empty")
                for p_idx, para in enumerate(paras):
                    self.assertIsInstance(para.get("en"), str)
                    self.assertTrue(para["en"].strip(), f"{art['id']} para {p_idx} 'en' empty")
                    self.assertIsInstance(para.get("vi"), str)
                    self.assertTrue(para["vi"].strip(), f"{art['id']} para {p_idx} 'vi' empty")
                    kws = para.get("keyWords")
                    self.assertIsInstance(kws, list, f"{art['id']} para {p_idx} keyWords must be list")
                    for kw in kws:
                        self.assertIsInstance(kw, dict)
                        for k_field in ("w", "ipa", "vi", "rootId"):
                            self.assertIn(k_field, kw, f"{art['id']} para {p_idx} keyWord missing '{k_field}'")
                            self.assertIsInstance(kw[k_field], str)
                        self.assertTrue(kw["w"].strip(), f"{art['id']} para {p_idx} keyWord 'w' empty")

                q = art.get("question")
                self.assertIsInstance(q, dict, f"Article {art['id']} missing question object")
                for q_field in ("promptEn", "promptVi", "sampleAnswer"):
                    val = q.get(q_field)
                    self.assertIsInstance(val, str, f"{art['id']} question.{q_field} must be str")
                    self.assertTrue(val.strip(), f"{art['id']} question.{q_field} must be non-empty")

    def test_t1_f2_04_roots_core_density_and_themes(self) -> None:
        """T1-F2-04: keyWords rootId values exist in 36 roots; dense core vocab & themed categories."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            matched_core_words: set[str] = set()
            matched_roots: set[str] = set()

            for art in articles:
                cat_low = art["category"].strip().lower()
                self.assertTrue(
                    any(theme in cat_low for theme in EXPECTED_THEMES),
                    f"Article {art['id']} category {art['category']!r} outside expected themes",
                )
                art_core_hits = 0
                for para in art["paragraphs"]:
                    tokens = set(re.findall(r"[a-z]+", para["en"].lower()))
                    hits = tokens & self.core_words
                    art_core_hits += len(hits)
                    matched_core_words.update(hits)
                    for kw in para["keyWords"]:
                        rid = kw.get("rootId", "").strip()
                        if rid:
                            self.assertIn(
                                rid,
                                self.valid_root_ids,
                                f"Unknown rootId {rid!r} in {art['id']} keyWord {kw['w']!r}",
                            )
                            matched_roots.add(rid)

                self.assertGreaterEqual(
                    art_core_hits,
                    3,
                    f"Article {art['id']} has too few 253-core words ({art_core_hits})",
                )

            self.assertGreaterEqual(
                len(matched_roots),
                18,
                f"Expected dense coverage of 36 roots across corpus, got {len(matched_roots)}",
            )
            self.assertGreaterEqual(
                len(matched_core_words),
                40,
                f"Expected dense coverage of 253 core words across corpus, got {len(matched_core_words)}",
            )

    def test_t1_f2_05_ui_level_tabs_show_3_articles_per_cefr(self) -> None:
        """T1-F2-05: Clicking A1->C1 in #enLevelTabs displays 3 articles per CEFR level in #enReaderList."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                for lvl in CEFR_LEVELS:
                    session.select_en_level(lvl)
                    items = session.page.locator("#enReaderList .kanji-item")
                    expect(items).to_have_count(3, timeout=5000)
                    meta = session.page.locator("#enReaderListMeta").inner_text()
                    self.assertIn("3", meta, f"Expected count '3' in #enReaderListMeta for {lvl}, got {meta!r}")
            finally:
                session.close()

    def test_t2_f2_01_no_null_fields_and_min_paragraphs(self) -> None:
        """T2-F2-01: 15 unique ids, every article has >=2 paragraphs, no null/empty keyWords fields."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            self.assertEqual(len({a["id"] for a in articles}), 15)
            for art in articles:
                self.assertGreaterEqual(len(art["paragraphs"]), 2, f"{art['id']} has < 2 paragraphs")
                for p_idx, para in enumerate(art["paragraphs"]):
                    self.assertGreater(len(para["keyWords"]), 0, f"{art['id']} para {p_idx} has 0 keyWords")
                    for kw in para["keyWords"]:
                        for req in ("w", "ipa", "vi"):
                            self.assertIsNotNone(kw.get(req))
                            self.assertTrue(str(kw[req]).strip(), f"{art['id']} keyWord '{req}' empty")

    def test_t2_f2_02_keywords_appear_in_paragraph_text(self) -> None:
        """T2-F2-02: Every keyWords[i].w actually appears in its paragraph's en text (case-insensitive)."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            for art in articles:
                for p_idx, para in enumerate(art["paragraphs"]):
                    en_low = para["en"].lower()
                    word_tokens = set(re.findall(r"[a-z]+(?:'[a-z]+)?", en_low))
                    for kw in para["keyWords"]:
                        w = kw["w"].strip().lower()
                        found = w in word_tokens or re.search(rf"\b{re.escape(w)}\b", en_low) is not None
                        self.assertTrue(
                            found,
                            f"keyWord {kw['w']!r} not found in {art['id']} para {p_idx}: {para['en']!r}",
                        )

    def test_t2_f2_03_root_coverage_density_across_36_roots(self) -> None:
        """T2-F2-03: Substantial coverage across the 36 roots with zero invalid rootIds."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            word_to_root = {
                item["w"].strip().lower(): item.get("rootId", "")
                for item in self.vocab_data
                if item.get("w") and item.get("rootId")
            }
            seen_roots: set[str] = set()
            for art in articles:
                for para in art["paragraphs"]:
                    for kw in para["keyWords"]:
                        rid = kw.get("rootId", "").strip()
                        if rid:
                            self.assertIn(rid, self.valid_root_ids)
                            seen_roots.add(rid)
                    for tok in re.findall(r"[a-z]+", para["en"].lower()):
                        if tok in word_to_root:
                            seen_roots.add(word_to_root[tok])
            self.assertGreaterEqual(
                len(seen_roots),
                24,
                f"Expected >= 24 of 36 roots covered across 15 articles, got {len(seen_roots)}: {sorted(seen_roots)}",
            )

    def test_t2_f2_04_valid_cefr_levels_no_jp_levels(self) -> None:
        """T2-F2-04: Strict CEFR A1..C1 level domain, zero JLPT N1..N5 or integer levels."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            for art in articles:
                self.assertIn(art.get("level"), CEFR_LEVELS, f"Invalid CEFR level: {art.get('level')!r}")
                self.assertIsInstance(art.get("category"), str)
                self.assertTrue(art["category"].strip())

    def test_t2_f2_05_xss_and_html_safety(self) -> None:
        """T2-F2-05: Zero unescaped <script> tags or raw HTML injection in dataset strings."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = self._load_readings_via_http(srv)
            raw_dump = json.dumps(articles, ensure_ascii=False)
            self.assertNotRegex(raw_dump, r"(?i)<\s*script\b")
            self.assertNotRegex(raw_dump, r"(?i)onerror\s*=|onload\s*=|javascript:")


if __name__ == "__main__":
    unittest.main()
