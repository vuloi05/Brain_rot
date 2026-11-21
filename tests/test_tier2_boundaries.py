"""Tier 2 Boundary & Corner Case E2E Tests (F1, F3, F4, F5, F6, F7 — 30 tests)."""

from __future__ import annotations

import json
import re
import time
import unittest
from typing import Any
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect

from tests.harness import (
    EXPECTED_BASELINE_KEYS,
    BrowserManager,
    IsolatedServer,
    PlaywrightSession,
    assert_baseline_records_preserved,
    capture_progress_snapshot,
    require_en_readings_dataset,
)

_BROWSER_MGR = BrowserManager()


def tearDownModule() -> None:
    _BROWSER_MGR.close()


class TestTier2LayoutAndReadingBoundaries(unittest.TestCase):
    """F1 & F3 Boundary Tests (T2-F1-01..05, T2-F3-01..05)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = IsolatedServer().start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.stop()

    def setUp(self) -> None:
        self.session = PlaywrightSession(_BROWSER_MGR.get_browser(), self.server)
        self.session.goto_app()

    def tearDown(self) -> None:
        self.session.close()

    def test_t2_f1_01_sidebar_collapse_across_view_switches(self) -> None:
        """T2-F1-01: Collapse sidebar in enReader, switch to enAtelier, return, expand cleanly."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        page.locator("#enReaderToggleSidebarBtn").click()
        expect(page.locator("#viewEnReader")).to_have_class(re.compile(r"\bsidebar-collapsed\b"))

        page.locator('#enViewTabs .en-view-btn[data-enview="enAtelier"]').click()
        expect(page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))

        page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]').click()
        expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_have_count(1)
        page.locator("#enReaderToggleSidebarBtn").click()
        expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bsidebar-collapsed\b"))
        expect(page.locator("#viewEnReader .panel-left")).to_be_visible()

    def test_t2_f1_02_rapid_tab_switching_across_all_5_en_tabs(self) -> None:
        """T2-F1-02: Rapidly switch all 5 #enViewTabs without duplicating #enLevelTabs or errors."""
        self.session.require_en_reader_m2_m3(check_list_populated=True)
        page = self.session.page
        page.locator("#spaceEnBtn").click()
        for view_name in ("enAtelier", "enSquadron", "enReader", "enDue", "neuro", "enReader"):
            page.locator(f'#enViewTabs .en-view-btn[data-enview="{view_name}"]').click()

        expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
        self.assertEqual(page.locator("#enLevelTabs").count(), 1)
        expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_have_count(1)

    def test_t2_f1_03_no_horizontal_overflow_at_1280x860(self) -> None:
        """T2-F1-03: At 1280x860 in #viewEnReader, scrollWidth <= innerWidth, topbar <60px, 0 .panel-right."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        dims = page.evaluate(
            "() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })"
        )
        self.assertLessEqual(dims["sw"], dims["iw"], f"Horizontal overflow: {dims}")
        box = page.locator("#enViewTabs").bounding_box()
        assert box is not None
        self.assertLess(box["height"], 60)
        self.assertEqual(page.locator("#viewEnReader .panel-right").count(), 0)

    def test_t2_f1_04_cold_boot_home_shortcut_loads_a1_articles(self) -> None:
        """T2-F1-04: Clicking #homeEnterEnReaderBtn on fresh load populates A1 articles cleanly."""
        self.session.open_en_reader_from_home()
        expect(self.session.page.locator("#enReaderList .kanji-item")).to_have_count(3, timeout=8000)

    def test_t2_f1_05_switch_en_reader_home_jp_reader_and_back(self) -> None:
        """T2-F1-05: Switching enReader -> Home -> JP Đọc sâu -> enReader keeps 2-zone & 3-zone independent."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        page.locator("#spaceHomeBtn").click()
        page.locator("#spaceJpBtn").click()
        page.locator('#jpViewTabs .view-btn[data-view="reader"]').click()
        expect(page.locator("#viewReader")).not_to_have_class(re.compile(r"\bhidden\b"))
        self.assertEqual(page.locator("#viewReader .panel-right").count(), 1)
        expect(page.locator("#viewReader .panel-left #jpLevelTabs")).to_have_count(1)

        page.locator("#spaceEnBtn").click()
        page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]').click()
        expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
        self.assertEqual(page.locator("#viewEnReader .panel-right").count(), 0)
        expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_have_count(1)

    def test_t2_f3_01_prev_and_next_article_boundaries(self) -> None:
        """T2-F3-01: Prev on 1st article & Next on last article stay bounded without crashing."""
        self.session.open_en_reader_via_tab()
        self.session.select_en_level("A1")
        page = self.session.page

        self.session.open_article_at(0)
        first_title = page.locator("#enReaderTitle").inner_text().strip()
        if not page.locator("#enReaderPrevBtn").is_disabled():
            page.locator("#enReaderPrevBtn").click()
        self.assertEqual(page.locator("#enReaderTitle").inner_text().strip(), first_title)

        self.session.open_article_at(2)
        last_title = page.locator("#enReaderTitle").inner_text().strip()
        if not page.locator("#enReaderNextBtn").is_disabled():
            page.locator("#enReaderNextBtn").click()
        self.assertEqual(page.locator("#enReaderTitle").inner_text().strip(), last_title)

    def test_t2_f3_02_search_no_matches_shows_empty_state(self) -> None:
        """T2-F3-02: Non-matching search shows 0 articles and clean empty prompt without crash."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        page.locator("#enReaderSearchInput").fill("zzzznonexistent999")
        expect(page.locator("#enReaderList .kanji-item")).to_have_count(0)
        self.assertIn("0", page.locator("#enReaderListMeta").inner_text())

    def test_t2_f3_03_global_shortcuts_blocked_in_reader_search_input(self) -> None:
        """T2-F3-03: Typing 1,2,3,4,[,] in #enReaderSearchInput does not trigger SRS grading or Atelier nav."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        before_prog = self.server.get_json("/api/progress")

        search = page.locator("#enReaderSearchInput")
        search.click()
        page.keyboard.type("1234[]")
        self.assertEqual(search.input_value(), "1234[]")
        expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))

        after_prog = self.server.get_json("/api/progress")
        self.assertEqual(after_prog["enVocab"], before_prog["enVocab"])

    def test_t2_f3_04_reset_mid_article_reblurs_and_hides_summary(self) -> None:
        """T2-F3-04: Reset mid-article after unlocking Para 2 & Vi restores Para 1 active & blurs Para 2."""
        self.session.open_en_reader_via_tab()
        self.session.select_en_level("A1")
        self.session.open_article_at(0)
        page = self.session.page

        page.locator("#enReaderParagraphs .para-card.active button").filter(
            has_text=re.compile(r"(Mở đoạn tiếp|Đã hiểu)", re.I)
        ).first.click()
        expect(page.locator("#enReaderParagraphs .para-card").nth(1)).not_to_have_class(
            re.compile(r"\bblurred\b")
        )
        page.locator("#enReaderTransAllBtn").click()
        page.locator("#enReaderResetBtn").click()

        cards = page.locator("#enReaderParagraphs .para-card")
        expect(cards.nth(0)).to_have_class(re.compile(r"\bactive\b"))
        expect(cards.nth(1)).to_have_class(re.compile(r"\bblurred\b"))
        expect(page.locator("#enReaderQuestionBox")).to_be_hidden()
        expect(page.locator("#enReaderSummaryBox")).to_be_hidden()

    def test_t2_f3_05_empty_done_and_custom_filters_show_zero(self) -> None:
        """T2-F3-05: Clicking done & custom filter chips with empty state shows 0 cleanly."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        for f_name in ("done", "custom"):
            page.locator(f'.en-reader-filter[data-enfilter="{f_name}"]').click()
            expect(page.locator("#enReaderList .kanji-item")).to_have_count(0)
            self.assertIn("0", page.locator("#enReaderListMeta").inner_text())


class TestTier2InspectorAndLookupBoundaries(unittest.TestCase):
    """F4 Boundary Tests (T2-F4-01..05)."""

    def test_t2_f4_01_punctuated_and_capitalized_tokens_strip_cleanly(self) -> None:
        """T2-F4-01: Tokens like 'Respect.', '(evidence)', 'build,' resolve to clean base words."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Punctuation Edge",
                    "A1",
                    '"Respect." Learners build, (evidence) together.',
                )
                for tok_word in ("respect", "evidence", "build"):
                    inspector = session.click_word_token(tok_word, para_index=0)
                    head_txt = inspector.inner_text().lower()
                    self.assertIn(tok_word, head_txt)
                    self.assertNotIn(f'"{tok_word}', head_txt)
                    self.assertNotIn(f"({tok_word}", head_txt)
            finally:
                session.close()

    def test_t2_f4_02_inflected_253_core_words_lemmatize_to_base_vocab(self) -> None:
        """T2-F4-02: Inflected tokens ('respects', 'respecting', 'predicts', 'transported') resolve to 253 base."""
        require_en_readings_dataset()
        vocab = json.loads((srv_vocab := __import__("tests.harness", fromlist=["EN_VOCAB_PATH"]).EN_VOCAB_PATH).read_text(encoding="utf-8"))
        vocab_map = {item["w"].lower(): item for item in vocab}
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Inflection Edge",
                    "B1",
                    "She respects practice while respecting rules, predicts outcomes, and transported notes.",
                )
                for inflected, base in (
                    ("respects", "respect"),
                    ("respecting", "respect"),
                    ("predicts", "predict"),
                    ("transported", "transport"),
                ):
                    inspector = session.click_word_token(inflected, para_index=0)
                    txt = inspector.inner_text()
                    self.assertIn(vocab_map[base]["ipa"], txt)
                    self.assertIn(vocab_map[base]["vi"][:12], txt)
            finally:
                session.close()

    def test_t2_f4_03_single_inline_inspector_moves_across_paragraphs(self) -> None:
        """T2-F4-03: Only 1 #enInlineInspector exists in DOM at a time and moves to active paragraph."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Multi Para Move",
                    "A1",
                    "Respect and build daily habits.\n\nSimple focus helps final clarity.",
                )
                session.click_word_token("respect", para_index=0)
                self.assertEqual(session.page.locator("#enInlineInspector").count(), 1)
                session.click_word_token("build", para_index=0)
                self.assertEqual(session.page.locator("#enInlineInspector").count(), 1)

                session.unlock_all_paragraphs()
                session.click_word_token("final", para_index=1)
                self.assertEqual(session.page.locator("#enInlineInspector").count(), 1)
                expect(
                    session.page.locator("#enReaderParagraphs .para-card").nth(1).locator("#enInlineInspector")
                ).to_be_visible()
            finally:
                session.close()

    def test_t2_f4_04_offline_lookup_not_cached_and_recovers_online(self) -> None:
        """T2-F4-04: Offline /api/en-lookup failure renders fallback cleanly and retries when back online."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            mode = {"online": False, "calls": 0}

            def _route_lookup(route: Any) -> None:
                mode["calls"] += 1
                if not mode["online"]:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(
                            {
                                "ok": True,
                                "found": False,
                                "offline": True,
                                "word": "neuroplasticity",
                                "ipa": "/neuroplasticity/",
                                "pos": "word",
                                "vi": "Chưa có nghĩa trực tuyến",
                                "enDef": "",
                                "exampleEn": "",
                            }
                        ),
                    )
                else:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(
                            {
                                "ok": True,
                                "found": True,
                                "offline": False,
                                "word": "neuroplasticity",
                                "ipa": "/ˌnjʊəroʊplæˈstɪsɪti/",
                                "pos": "noun",
                                "vi": "tính dẻo thần kinh",
                                "enDef": "Brain reorganization.",
                                "exampleEn": "",
                            }
                        ),
                    )

            session.page.route("**/api/en-lookup*", _route_lookup)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Offline Retry",
                    "B2",
                    "Neuroplasticity matters for reading.",
                )

                # 1st click: offline fallback
                inspector = session.click_word_token("neuroplasticity", para_index=0)
                txt1 = inspector.inner_text()
                self.assertNotIn("undefined", txt1.lower())
                self.assertEqual(mode["calls"], 1)

                # 2nd click: online -> must NOT reuse cached offline failure
                mode["online"] = True
                session.click_word_token("reading", para_index=0)
                inspector2 = session.click_word_token("neuroplasticity", para_index=0)
                expect(inspector2).to_contain_text("tính dẻo thần kinh", timeout=5000)
                self.assertGreaterEqual(mode["calls"], 2)
            finally:
                session.close()

    def test_t2_f4_05_api_en_lookup_invalid_params_return_400(self) -> None:
        """T2-F4-05: GET /api/en-lookup?word= and ?word=123!!! return HTTP 400 {ok: false}."""
        with IsolatedServer() as srv:
            st1, b1 = srv.get_json_with_status("/api/en-lookup?word=")
            self.assertEqual(st1, 400)
            self.assertFalse(b1.get("ok"))

            st2, b2 = srv.get_json_with_status("/api/en-lookup?word=123!!!")
            self.assertEqual(st2, 400)
            self.assertFalse(b2.get("ok"))


class TestTier2SrsAndCustomBoundaries(unittest.TestCase):
    """F5 & F6 Boundary Tests (T2-F5-01..05, T2-F6-01..05)."""

    def test_t2_f5_01_duplicate_srs_enqueue_is_idempotent(self) -> None:
        """T2-F5-01: Clicking + Đưa vào SRS Hôm nay twice on 'final' increments due badge only once."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                before_due = int(re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group())
                session.paste_custom_article("Idempotent SRS", "A1", "The final step matters.")
                inspector = session.click_word_token("final", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS|Đã", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                # Click second time (button may be disabled or idempotent)
                if add_btn.is_enabled():
                    add_btn.click()
                    session.page.wait_for_timeout(450)

                after_due = int(re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group())
                self.assertEqual(after_due, before_due + 1)
                prog = srv.get_json("/api/progress")
                self.assertIn("final", prog["enVocab"])
            finally:
                session.close()

    def test_t2_f5_02_re_enqueue_existing_learned_word_preserves_srs_stats(self) -> None:
        """T2-F5-02: Re-enqueuing baseline learned word 'message' preserves reps/blindPasses/ease."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            before_msg = srv.get_json("/api/progress")["enVocab"]["message"]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article("Learned Word", "A1", "Send a clear message.")
                inspector = session.click_word_token("message", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                if add_btn.is_enabled():
                    session.wait_for_progress_save(lambda: add_btn.click())
                after_msg = srv.get_json("/api/progress")["enVocab"]["message"]
                self.assertEqual(after_msg["reps"], before_msg["reps"])
                self.assertEqual(after_msg["blindPasses"], before_msg["blindPasses"])
                self.assertEqual(after_msg["ease"], before_msg["ease"])
            finally:
                session.close()

    def test_t2_f5_03_jump_to_word_clears_conflicting_root_and_status_filters(self) -> None:
        """T2-F5-03: jumpToWord clears active root filter ('port') / 'today' filter and lands on 'evidence'."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                page = session.page
                page.locator("#spaceEnBtn").click()
                # Apply conflicting root filter in Atelier
                page.locator("#enFilterDrawerToggle").click()
                root_sel = page.locator("#enRootFilterSelect")
                expect(root_sel).to_be_visible()
                root_sel.select_option("port")

                session.open_en_reader_via_tab()
                session.paste_custom_article("Filter Override", "B2", "Solid evidence wins.")
                inspector = session.click_word_token("evidence", para_index=0)
                inspector.locator("button").filter(
                    has_text=re.compile(r"Mở trong Xưởng Gốc Từ", re.I)
                ).first.click()

                expect(page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#enPromptWord")).to_contain_text("evidence", ignore_case=True)
                expect(page.locator('#enLevelTabs .en-level-btn[data-enlevel="B2"]')).to_have_class(
                    re.compile(r"\bactive\b")
                )
                self.assertEqual(root_sel.input_value(), "")
            finally:
                session.close()

    def test_t2_f5_04_jump_to_word_rare_non_10k_word_renders_stub_cleanly(self) -> None:
        """T2-F5-04: Mở trong Xưởng Gốc Từ → on rare word 'neuroplasticity' displays stub without crashing."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            session.page.route(
                "**/api/en-lookup*",
                lambda r: r.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "ok": True,
                            "found": True,
                            "offline": False,
                            "word": "neuroplasticity",
                            "ipa": "/ˌnjʊəroʊplæˈstɪsɪti/",
                            "pos": "noun",
                            "vi": "tính mềm dẻo thần kinh",
                            "enDef": "Brain adaptability.",
                        }
                    ),
                ),
            )
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article("Rare Jump", "C1", "Neuroplasticity adapts.")
                inspector = session.click_word_token("neuroplasticity", para_index=0)
                inspector.locator("button").filter(
                    has_text=re.compile(r"Mở trong Xưởng Gốc Từ", re.I)
                ).first.click()

                expect(session.page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(session.page.locator("#enPromptWord")).to_contain_text(
                    "neuroplasticity", ignore_case=True, timeout=8000
                )
            finally:
                session.close()

    def test_t2_f5_05_grade_enqueued_non_253_word_in_due_view(self) -> None:
        """T2-F5-05: Grading non-253 'cognitive' in Ôn tập updates reps=1, future due, decrements badge."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            session.page.route(
                "**/api/en-lookup*",
                lambda r: r.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "ok": True,
                            "found": True,
                            "offline": False,
                            "word": "cognitive",
                            "ipa": "/ˈkɑːɡnətɪv/",
                            "pos": "adjective",
                            "vi": "nhận thức",
                            "enDef": "Related to cognition.",
                        }
                    ),
                ),
            )
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article("Due Grade", "B2", "Cognitive agility grows.")
                inspector = session.click_word_token("cognitive", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                due_before = int(re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group())
                session.page.locator('#enViewTabs .en-view-btn[data-enview="enDue"]').click()
                cog_item = session.page.locator("#enWordList .kanji-item").filter(
                    has_text=re.compile(r"\bcognitive\b", re.I)
                ).first
                expect(cog_item).to_be_visible(timeout=5000)
                cog_item.click()

                grade_btn = session.page.locator('#enStickySrsFooter .en-srs-btn[data-quality="3"]')
                session.wait_for_progress_save(lambda: grade_btn.click())

                due_after = int(re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group())
                self.assertEqual(due_after, due_before - 1)
                prog = srv.get_json("/api/progress")
                self.assertEqual(prog["enVocab"]["cognitive"]["reps"], 1)
            finally:
                session.close()

    def test_t2_f5_06_rapid_jump_to_word_prevents_stale_overwrite(self) -> None:
        """T2-F5-06: Rapid jumpToWord('slowjump') -> ('fastjump') never lets stale slow response overwrite UI."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            completed_order: list[str] = []

            def _route_lookup(route: Any) -> None:
                qs = parse_qs(urlparse(route.request.url).query)
                word = (qs.get("word") or [""])[0].lower()
                if word in ("slowjump", "slowsel"):
                    session.page.wait_for_timeout(1100)
                    completed_order.append(word)
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(
                            {
                                "ok": True,
                                "found": True,
                                "offline": False,
                                "word": word,
                                "ipa": f"/{word}/",
                                "pos": "noun",
                                "vi": "NGHIA_CHAM_STALE",
                                "enDef": "Slow stale definition.",
                            }
                        ),
                    )
                else:
                    session.page.wait_for_timeout(40)
                    completed_order.append(word)
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(
                            {
                                "ok": True,
                                "found": True,
                                "offline": False,
                                "word": word,
                                "ipa": f"/{word}/",
                                "pos": "noun",
                                "vi": "NGHIA_NHANH_FRESH",
                                "enDef": "Fast fresh definition.",
                            }
                        ),
                    )

            session.page.route("**/api/en-lookup*", _route_lookup)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()

                # Case 1: Rapid jumpToWord from enReader -> enAtelier (50ms gap)
                session.page.evaluate(
                    """() => {
                        window.EnAtelierApp.jumpToWord('slowjump');
                        setTimeout(() => window.EnAtelierApp.jumpToWord('fastjump'), 50);
                    }"""
                )
                expect(session.page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(session.page.locator("#enPromptWord")).to_have_text("fastjump", timeout=5000)
                expect(session.page.locator("#enPromptVi")).to_have_text("NGHIA_NHANH_FRESH", timeout=5000)
                # Wait past slowjump's 1100ms response to prove stale response does not overwrite
                deadline = time.monotonic() + 3.0
                while "slowjump" not in completed_order and time.monotonic() < deadline:
                    session.page.wait_for_timeout(50)
                session.page.wait_for_timeout(200)
                self.assertIn("slowjump", completed_order)
                self.assertEqual(completed_order.index("fastjump") < completed_order.index("slowjump"), True)
                expect(session.page.locator("#enPromptWord")).to_have_text("fastjump")
                expect(session.page.locator("#enPromptVi")).to_have_text("NGHIA_NHANH_FRESH")

                # Case 2: Rapid jumpToWord while already in enAtelier and first lookup is in flight (400ms gap)
                completed_order.clear()
                session.page.evaluate(
                    """() => {
                        window.EnAtelierApp.jumpToWord('slowsel');
                        setTimeout(() => window.EnAtelierApp.jumpToWord('fastsel'), 400);
                    }"""
                )
                expect(session.page.locator("#enPromptWord")).to_have_text("fastsel", timeout=5000)
                expect(session.page.locator("#enPromptVi")).to_have_text("NGHIA_NHANH_FRESH", timeout=5000)
                deadline = time.monotonic() + 3.0
                while "slowsel" not in completed_order and time.monotonic() < deadline:
                    session.page.wait_for_timeout(50)
                session.page.wait_for_timeout(200)
                self.assertIn("slowsel", completed_order)
                self.assertEqual(completed_order.index("fastsel") < completed_order.index("slowsel"), True)
                expect(session.page.locator("#enPromptWord")).to_have_text("fastsel")
                expect(session.page.locator("#enPromptVi")).to_have_text("NGHIA_NHANH_FRESH")
            finally:
                session.close()

    def test_t2_f6_01_empty_and_whitespace_custom_paste_blocked(self) -> None:
        """T2-F6-01: Empty or whitespace-only custom title/body does not create enCustomReadings."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                page = session.page
                page.locator("#openEnCustomReadingBtn").click()
                page.locator("#enCustomSaveBtn").click()
                expect(page.locator("#enCustomReadingForm")).not_to_have_class(re.compile(r"\bhidden\b"))

                page.locator("#enCustomTitle").fill("   ")
                page.locator("#enCustomBody").fill("   \n   ")
                page.locator("#enCustomSaveBtn").click()
                page.wait_for_timeout(400)

                prog = srv.get_json("/api/progress")
                self.assertEqual(prog.get("enCustomReadings", []), [])
            finally:
                session.close()

    def test_t2_f6_02_whitespace_summary_handled_safely_without_corruption(self) -> None:
        """T2-F6-02: Submitting whitespace summary never crashes or corrupts enReadingsDone/Notes."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()

                session.page.locator("#enReaderSummaryInput").fill("   ")
                session.page.locator("#enReaderCompleteBtn").click()
                session.page.wait_for_timeout(500)

                prog = srv.get_json("/api/progress")
                self.assertIsInstance(prog.get("enReadingsDone"), dict)
                self.assertIsInstance(prog.get("enReadingNotes"), dict)
                raw = json.dumps(prog)
                self.assertNotIn("undefined", raw)
            finally:
                session.close()

    def test_t2_f6_03_custom_paste_xss_and_quotes_escaped_safely(self) -> None:
        """T2-F6-03: Custom paste containing <script>window.__xss=1</script> renders safely escaped."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                payload = '<script>window.__xss=1</script> & "quotes"'
                session.paste_custom_article(
                    f"XSS Check {payload}",
                    "A2",
                    f"Safe text with {payload} inside paragraph.",
                )
                self.assertIsNone(session.page.evaluate("() => window.__xss"))
                expect(session.page.locator("#enReaderTitle")).to_contain_text("<script>")
                expect(session.page.locator("#enReaderParagraphs")).to_contain_text("quotes")
            finally:
                session.close()

    def test_t2_f6_04_custom_paste_splits_three_paragraphs(self) -> None:
        """T2-F6-04: Custom paste with 3 blank-line separated paragraphs creates 3 .para-card nodes."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Three Paragraphs",
                    "B1",
                    "Paragraph one focus.\n\nParagraph two memory.\n\nParagraph three recall.",
                )
                expect(session.page.locator("#enReaderParagraphs .para-card")).to_have_count(3)
            finally:
                session.close()

    def test_t2_f6_05_updating_completed_summary_no_double_count(self) -> None:
        """T2-F6-05: Re-submitting summary updates text in enReadingsDone/Notes without double-counting."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            a1_art = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "A1"][0]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()

                session.submit_summary("First summary.")
                session.submit_summary("Updated deeper summary.")

                prog = srv.get_json("/api/progress")
                self.assertEqual(len(prog["enReadingsDone"]), 1)
                self.assertEqual(prog["enReadingsDone"][a1_art["id"]]["summary"], "Updated deeper summary.")
                self.assertEqual(prog["enReadingNotes"][a1_art["id"]]["summary"], "Updated deeper summary.")

                session.page.locator("#spaceHomeBtn").click()
                expect(session.page.locator("#homeEnReadings")).to_contain_text("1 / 15")
            finally:
                session.close()


class TestTier2IntegrityAndNeuroBoundaries(unittest.TestCase):
    """F7 Boundary Tests (T2-F7-01..05)."""

    def test_t2_f7_01_heavy_en_reader_activity_preserves_18_kanji_15_en_vocab(self) -> None:
        """T2-F7-01: Completing 2 readings, 1 custom paste, 3 new SRS words keeps 18 kanji & 15 enVocab."""
        require_en_readings_dataset()
        snap = capture_progress_snapshot()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                for idx in (0, 1):
                    session.select_en_level("A1")
                    session.open_article_at(idx)
                    session.unlock_all_paragraphs()
                    session.submit_summary(f"Summary for article {idx + 1}.")

                session.paste_custom_article(
                    "Heavy Activity",
                    "A1",
                    "Respect final simple evidence support.",
                )
                for w in ("respect", "final", "simple"):
                    ins = session.click_word_token(w, para_index=0)
                    btn = ins.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                    session.wait_for_progress_save(lambda: btn.click())

                prog = srv.get_json("/api/progress")
                assert_baseline_records_preserved(prog, snap)
                self.assertEqual(len(prog["enReadingsDone"]), 2)
                self.assertEqual(len(prog["enCustomReadings"]), 1)
            finally:
                session.close()

    def test_t2_f7_02_neuro_dashboard_transitions_0_to_1_plus_custom(self) -> None:
        """T2-F7-02: Neuro dashboard transitions 0 / 15 -> 1 / 15 (+1 bài tự dán) & shows both summaries."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.page.locator("#spaceEnBtn").click()
                session.page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(session.page.locator("#neuroModuleSummary")).to_contain_text("0 / 15")

                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                session.submit_summary("Built-in A1 summary note.")

                session.paste_custom_article("Custom Journal Title", "B1", "Brain focus paragraph.")
                session.unlock_all_paragraphs()
                session.submit_summary("Custom article summary note.")

                session.page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(session.page.locator("#neuroModuleSummary")).to_contain_text("1 / 15")
                expect(session.page.locator("#neuroModuleSummary")).to_contain_text("+1")
                expect(session.page.locator("#neuroNotesArchive")).to_contain_text("Built-in A1 summary note.")
                expect(session.page.locator("#neuroNotesArchive")).to_contain_text("Custom article summary note.")
            finally:
                session.close()

    def test_t2_f7_03_nonexistent_progress_file_creates_clean_defaults(self) -> None:
        """T2-F7-03: Starting server with non-existent BOKUSEKI_PROGRESS_FILE creates EN reader defaults."""
        with IsolatedServer(create_progress_copy=False) as srv:
            prog = srv.get_json("/api/progress")
            self.assertEqual(prog.get("enReadingsDone"), {})
            self.assertEqual(prog.get("enReadingNotes"), {})
            self.assertEqual(prog.get("enCustomReadings"), [])

    def test_t2_f7_04_reload_from_home_and_reader_preserves_state(self) -> None:
        """T2-F7-04: Reloading preserves enReadingsDone, enReadingNotes, enCustomReadings & enVocab."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article("Reload Custom", "A2", "Respect builds strong habits.")
                ins = session.click_word_token("respect", para_index=0)
                btn = ins.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: btn.click())
                session.unlock_all_paragraphs()
                session.submit_summary("Custom reload summary.")

                session.reload_app()
                session.page.locator("#spaceEnBtn").click()
                session.page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(session.page.locator("#neuroNotesArchive")).to_contain_text("Custom reload summary.")
                prog = srv.get_json("/api/progress")
                self.assertIn("respect", prog["enVocab"])
                self.assertEqual(len(prog["enCustomReadings"]), 1)
            finally:
                session.close()

    def test_t2_f7_05_progress_json_export_schema_compatible(self) -> None:
        """T2-F7-05: GET /api/progress contains all 12 baseline keys + EN reading extension keys."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                session.submit_summary("Schema check summary.")

                prog = srv.get_json("/api/progress")
                self.assertTrue(EXPECTED_BASELINE_KEYS.issubset(prog.keys()))
                self.assertIn("enReadingsDone", prog)
                self.assertIn("enReadingNotes", prog)
                self.assertIn("enCustomReadings", prog)
                self.assertIsInstance(prog["enReadingsDone"], dict)
                self.assertIsInstance(prog["enReadingNotes"], dict)
                self.assertIsInstance(prog["enCustomReadings"], list)
            finally:
                session.close()


if __name__ == "__main__":
    unittest.main()
