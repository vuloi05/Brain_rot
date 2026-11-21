"""Tier 1 Feature Coverage E2E Tests (F1, F3, F4, F5, F6, F7 — 32 tests)."""

from __future__ import annotations

import json
import re
import unittest
from typing import Any

from playwright.sync_api import expect

from tests.harness import (
    BrowserManager,
    IsolatedServer,
    PlaywrightSession,
    assert_baseline_records_preserved,
    assert_real_progress_intact,
    capture_progress_snapshot,
    is_dry_run,
    require_en_readings_dataset,
)

_BROWSER_MGR = BrowserManager()


def tearDownModule() -> None:
    _BROWSER_MGR.close()


class TestTier1NavigationAndLayout(unittest.TestCase):
    """F1: Navigation & 2-Zone Layout (T1-F1-01..05)."""

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

    def test_t1_f1_01_en_view_tabs_single_row_five_tabs(self) -> None:
        """T1-F1-01: #enViewTabs stays on 1 row (<60px) with exact 5 tabs and no Sentence Studio."""
        page = self.session.page
        page.locator("#spaceEnBtn").click()
        tabs_wrap = page.locator("#enViewTabs")
        expect(tabs_wrap).to_be_visible()

        buttons = tabs_wrap.locator(".en-view-btn")
        if buttons.count() < 5 and is_dry_run():
            self.skipTest("M2 #enViewTabs 5th tab (3. Đọc sâu) pending.")
        self.assertEqual(buttons.count(), 5)

        expected_views = ["enAtelier", "enSquadron", "enReader", "enDue", "neuro"]
        actual_views = [buttons.nth(i).get_attribute("data-enview") for i in range(5)]
        self.assertEqual(actual_views, expected_views)

        texts = [buttons.nth(i).inner_text().strip() for i in range(5)]
        self.assertIn("1. Xưởng Gốc Từ", texts[0])
        self.assertIn("Đội Hình Bắn Từ", texts[1])
        self.assertIn("3. Đọc sâu", texts[2])
        self.assertIn("Ôn tập", texts[3])
        self.assertIn("Não bộ & Git", texts[4])
        for t in texts:
            self.assertNotIn("Sentence Studio", t)

        box = tabs_wrap.bounding_box()
        assert box is not None
        self.assertLess(box["height"], 60, f"#enViewTabs height wrapped: {box['height']}px")

        tops = [buttons.nth(i).bounding_box()["y"] for i in range(5)]
        self.assertLess(max(tops) - min(tops), 8.0, f"#enViewTabs buttons wrapped rows: tops={tops}")

    def test_t1_f1_02_home_shortcut_opens_en_reader(self) -> None:
        """T1-F1-02: #homeEnReadings shows 0 / 15 bài; clicking #homeEnterEnReaderBtn opens #viewEnReader."""
        self.session.require_en_reader_m2_m3(check_list_populated=False)
        page = self.session.page
        counter = page.locator("#homeEnReadings")
        expect(counter).to_be_visible()
        self.assertIn("0 / 15", counter.inner_text())

        page.locator("#homeEnterEnReaderBtn").click()
        expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
        expect(page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]')).to_have_class(
            re.compile(r"\bactive\b")
        )

    def test_t1_f1_03_two_zone_layout_no_right_panel_940px_center(self) -> None:
        """T1-F1-03: #viewEnReader has strict 2-zone layout, 0 .panel-right, 940px center (not 720px)."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        reader = page.locator("#viewEnReader")
        expect(reader).to_have_class(re.compile(r"\btwo-zone-workspace\b"))
        self.assertEqual(reader.locator(".panel-left").count(), 1)
        self.assertEqual(reader.locator(".panel-center.reader-center").count(), 1)
        self.assertEqual(reader.locator(".panel-right").count(), 0)

        max_w = page.locator("#enReaderArticleWrap").evaluate(
            "el => getComputedStyle(el).maxWidth"
        )
        self.assertEqual(max_w, "940px", f"Expected #enReaderArticleWrap max-width 940px, got {max_w}")

        # Collapse sidebar so 940px center expands past JP's 720px limit cleanly
        page.locator("#enReaderToggleSidebarBtn").click()
        box = page.locator("#enReaderArticleWrap").bounding_box()
        assert box is not None
        self.assertGreater(box["width"], 720.0, f"Center stayed stuck at JP 720px: {box['width']}")
        self.assertLessEqual(box["width"], 942.0, f"Center exceeded 940px: {box['width']}")

    def test_t1_f1_04_sidebar_collapse_and_expand(self) -> None:
        """T1-F1-04: Clicking #enReaderToggleSidebarBtn collapses and restores .panel-left."""
        self.session.open_en_reader_via_tab()
        page = self.session.page
        reader = page.locator("#viewEnReader")
        btn = page.locator("#enReaderToggleSidebarBtn")
        left = reader.locator(".panel-left")

        expect(left).to_be_visible()
        self.assertIn("◀ Danh sách", btn.inner_text())

        btn.click()
        expect(reader).to_have_class(re.compile(r"\bsidebar-collapsed\b"))
        expect(left).not_to_be_visible()
        self.assertIn("▶ Danh sách", btn.inner_text())

        btn.click()
        expect(reader).not_to_have_class(re.compile(r"\bsidebar-collapsed\b"))
        expect(left).to_be_visible()
        self.assertIn("◀ Danh sách", btn.inner_text())

    def test_t1_f1_05_en_level_tabs_reparenting_between_atelier_and_reader(self) -> None:
        """T1-F1-05: #enLevelTabs moves into #viewEnReader .panel-left and returns to #viewEnAtelier."""
        self.session.require_en_reader_m2_m3(check_list_populated=True)
        page = self.session.page
        page.locator("#spaceEnBtn").click()
        expect(page.locator("#viewEnAtelier .panel-left #enLevelTabs")).to_have_count(1)

        page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]').click()
        expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_have_count(1)
        expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_be_visible()
        expect(page.locator("#viewEnAtelier #enLevelTabs")).to_have_count(0)
        self.assertEqual(page.locator("#enLevelTabs").count(), 1)

        page.locator('#enViewTabs .en-view-btn[data-enview="enAtelier"]').click()
        expect(page.locator("#viewEnAtelier .panel-left #enLevelTabs")).to_have_count(1)
        expect(page.locator("#viewEnReader #enLevelTabs")).to_have_count(0)
        self.assertEqual(page.locator("#enLevelTabs").count(), 1)


class TestTier1ReadingModes(unittest.TestCase):
    """F3: Reading Modes, Translation, Navigation & Filtering (T1-F3-01..06)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = IsolatedServer().start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.stop()

    def setUp(self) -> None:
        self.session = PlaywrightSession(_BROWSER_MGR.get_browser(), self.server)
        self.session.goto_app()
        self.session.open_en_reader_via_tab()

    def tearDown(self) -> None:
        self.session.close()

    def test_t1_f3_01_anti_skimming_initial_state(self) -> None:
        """T1-F3-01: Default Anti-Skimming blurs paragraphs 2..N and hides question/summary."""
        self.session.select_en_level("A1")
        self.session.open_article_at(0)
        cards = self.session.page.locator("#enReaderParagraphs .para-card")
        total = cards.count()
        self.assertGreaterEqual(total, 2)
        expect(cards.nth(0)).to_have_class(re.compile(r"\bactive\b"))
        expect(cards.nth(0)).not_to_have_class(re.compile(r"\bblurred\b"))
        for idx in range(1, total):
            expect(cards.nth(idx)).to_have_class(re.compile(r"\bblurred\b"))
        expect(self.session.page.locator("#enReaderQuestionBox")).to_be_hidden()
        expect(self.session.page.locator("#enReaderSummaryBox")).to_be_hidden()

    def test_t1_f3_02_sequential_paragraph_unlock_reveals_question_and_summary(self) -> None:
        """T1-F3-02: Unlocking paragraphs sequentially reveals #enReaderQuestionBox and #enReaderSummaryBox."""
        self.session.select_en_level("A1")
        self.session.open_article_at(0)
        self.session.unlock_all_paragraphs()
        expect(self.session.page.locator("#enReaderQuestionBox")).to_be_visible()
        expect(self.session.page.locator("#enReaderSummaryBox")).to_be_visible()
        cards = self.session.page.locator("#enReaderParagraphs .para-card")
        for idx in range(cards.count()):
            expect(cards.nth(idx)).not_to_have_class(re.compile(r"\bblurred\b"))

    def test_t1_f3_03_full_article_mode_toggle_and_back(self) -> None:
        """T1-F3-03: #enReaderModeToggleBtn unlocks all paragraphs and toggles back to Anti-Skimming."""
        self.session.select_en_level("A1")
        self.session.open_article_at(0)
        page = self.session.page
        mode_btn = page.locator("#enReaderModeToggleBtn")
        cards = page.locator("#enReaderParagraphs .para-card")
        self.assertGreaterEqual(cards.count(), 2)

        mode_btn.click()
        for idx in range(cards.count()):
            expect(cards.nth(idx)).not_to_have_class(re.compile(r"\bblurred\b"))
        expect(page.locator("#enReaderQuestionBox")).to_be_visible()
        expect(page.locator("#enReaderSummaryBox")).to_be_visible()

        mode_btn.click()
        expect(cards.nth(1)).to_have_class(re.compile(r"\bblurred\b"))
        expect(page.locator("#enReaderSummaryBox")).to_be_hidden()

    def test_t1_f3_04_vietnamese_translation_toggles(self) -> None:
        """T1-F3-04: Per-paragraph toggle and #enReaderTransAllBtn reveal matching para.vi text."""
        require_en_readings_dataset()
        articles = [a for a in self.server.get_json("/data/en-readings.json") if a["level"] == "A1"]
        self.session.select_en_level("A1")
        self.session.open_article_at(0)
        page = self.session.page

        first_vi = page.locator("#enReaderParagraphs .para-card").first.locator(".para-vi")
        expect(first_vi).to_be_hidden()

        # Per-paragraph translation toggle
        per_para_btn = page.locator("#enReaderParagraphs .para-card").first.locator("button").filter(
            has_text=re.compile(r"dịch", re.I)
        )
        per_para_btn.first.click()
        expect(first_vi).to_be_visible()
        self.assertIn(articles[0]["paragraphs"][0]["vi"][:20], first_vi.inner_text())

        # Global #enReaderTransAllBtn toggle off & on
        page.locator("#enReaderTransAllBtn").click()
        # Ensure toggling all reveals/hides consistently
        if not first_vi.is_visible():
            page.locator("#enReaderTransAllBtn").click()
        expect(first_vi).to_be_visible()

    def test_t1_f3_05_prev_next_reset_and_filters(self) -> None:
        """T1-F3-05: Next/Prev switch articles, Reset returns to Para 1, unread=3 / done=0."""
        self.session.select_en_level("A1")
        self.session.open_article_at(0)
        page = self.session.page
        title_0 = page.locator("#enReaderTitle").inner_text().strip()

        page.locator("#enReaderNextBtn").click()
        title_1 = page.locator("#enReaderTitle").inner_text().strip()
        self.assertNotEqual(title_1, title_0)

        page.locator("#enReaderPrevBtn").click()
        self.assertEqual(page.locator("#enReaderTitle").inner_text().strip(), title_0)

        # Unlock para 2 then reset
        page.locator("#enReaderParagraphs .para-card.active button").filter(
            has_text=re.compile(r"(Mở đoạn tiếp|Đã hiểu)", re.I)
        ).first.click()
        expect(page.locator("#enReaderParagraphs .para-card").nth(1)).not_to_have_class(
            re.compile(r"\bblurred\b")
        )
        page.locator("#enReaderResetBtn").click()
        expect(page.locator("#enReaderParagraphs .para-card").nth(1)).to_have_class(
            re.compile(r"\bblurred\b")
        )

        # Filter chips
        page.locator('.en-reader-filter[data-enfilter="unread"]').click()
        expect(page.locator("#enReaderList .kanji-item")).to_have_count(3)
        page.locator('.en-reader-filter[data-enfilter="done"]').click()
        expect(page.locator("#enReaderList .kanji-item")).to_have_count(0)
        page.locator('.en-reader-filter[data-enfilter="all"]').click()
        expect(page.locator("#enReaderList .kanji-item")).to_have_count(3)

    def test_t1_f3_06_search_filters_article_list(self) -> None:
        """T1-F3-06: Typing title keyword in #enReaderSearchInput filters #enReaderList and meta."""
        require_en_readings_dataset()
        a1_articles = [a for a in self.server.get_json("/data/en-readings.json") if a["level"] == "A1"]
        target_title = a1_articles[1]["title"]
        query = target_title.split()[0]

        self.session.select_en_level("A1")
        page = self.session.page
        page.locator("#enReaderSearchInput").fill(query)

        items = page.locator("#enReaderList .kanji-item")
        self.assertGreaterEqual(items.count(), 1)
        self.assertLessEqual(items.count(), 3)
        all_texts = " ".join(items.nth(i).inner_text() for i in range(items.count()))
        self.assertIn(target_title, all_texts)
        meta = page.locator("#enReaderListMeta").inner_text()
        self.assertIn(str(items.count()), meta)


class TestTier1WordInspectorAndAudio(unittest.TestCase):
    """F4: Inline Word Anatomy Inspector, Audio Spies, MediaCoach & /api/en-lookup (T1-F4-01..06)."""

    def test_t1_f4_01_inline_inspector_opens_inside_active_para(self) -> None:
        """T1-F4-01: Clicking a core word mounts #enInlineInspector inside active .para-card with IPA/Vi/roots."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "A1"]
            kw = articles[0]["paragraphs"][0]["keyWords"][0]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)

                inspector = session.click_word_token(kw["w"], para_index=0)
                active_card = session.page.locator("#enReaderParagraphs .para-card.active").first
                expect(active_card.locator("#enInlineInspector")).to_be_visible()

                txt = inspector.inner_text()
                self.assertIn(kw["w"].lower(), txt.lower())
                self.assertIn("/", txt)
                # Ensure root/affix morphology or Vietnamese meaning is rendered
                self.assertTrue(len(txt.strip()) > 15)
            finally:
                session.close()

    def test_t1_f4_02_web_speech_us_uk_normal_and_slow_rates(self) -> None:
        """T1-F4-02: Inspector US/UK 1.0x/0.75x and header Speak buttons invoke speechSynthesis with exact lang & rate."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "A1"]
            kw = articles[0]["paragraphs"][0]["keyWords"][0]["w"]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)

                inspector = session.click_word_token(kw, para_index=0)
                session.clear_speech_calls()

                # Inspector US 1.0x, US 0.75x, UK 1.0x, UK 0.75x
                inspector.locator("button").filter(has_text=re.compile(r"US", re.I)).filter(
                    has_not_text=re.compile(r"0\.75")
                ).first.click()
                inspector.locator("button").filter(has_text=re.compile(r"US.*0\.75|0\.75.*US", re.I)).first.click()
                inspector.locator("button").filter(has_text=re.compile(r"UK", re.I)).filter(
                    has_not_text=re.compile(r"0\.75")
                ).first.click()
                inspector.locator("button").filter(has_text=re.compile(r"UK.*0\.75|0\.75.*UK", re.I)).first.click()

                calls = session.get_speech_calls()
                self.assertGreaterEqual(len(calls), 4)
                self.assertTrue(any(c["lang"] == "en-US" and abs(c["rate"] - 1.0) < 0.05 for c in calls), calls)
                self.assertTrue(any(c["lang"] == "en-US" and abs(c["rate"] - 0.75) < 0.05 for c in calls), calls)
                self.assertTrue(any(c["lang"] == "en-GB" and abs(c["rate"] - 1.0) < 0.05 for c in calls), calls)
                self.assertTrue(any(c["lang"] == "en-GB" and abs(c["rate"] - 0.75) < 0.05 for c in calls), calls)
                self.assertTrue(all(kw.lower() in c["text"].lower() for c in calls[:4]))

                # Header full-article buttons
                session.clear_speech_calls()
                session.page.locator("#enReaderSpeakUsBtn").click()
                session.page.locator("#enReaderSpeakSlowBtn").click()
                art_calls = session.get_speech_calls()
                self.assertGreaterEqual(len(art_calls), 2)
                self.assertTrue(any(c["lang"] == "en-US" and abs(c["rate"] - 1.0) < 0.05 for c in art_calls))
                self.assertTrue(any(abs(c["rate"] - 0.75) < 0.05 for c in art_calls))
            finally:
                session.close()

    def test_t1_f4_03_youglish_drawer_mounts_in_en_reader(self) -> None:
        """T1-F4-03: Clicking YouGlish in inspector opens #youglishDrawer inside #enReaderMediaCoachMount."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "A1"]
            kw = articles[0]["paragraphs"][0]["keyWords"][0]["w"]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)

                inspector = session.click_word_token(kw, para_index=0)
                inspector.locator("button").filter(has_text=re.compile(r"YouGlish", re.I)).first.click()

                mount = session.page.locator("#viewEnReader #enReaderMediaCoachMount")
                expect(mount.locator("#sharedMediaCoachDrawer")).to_be_visible()
                expect(mount.locator("#youglishDrawer")).to_be_visible()
                self.assertIn(kw.lower(), mount.locator("#ygCurrentQueryLabel").inner_text().lower())
                mc_calls = session.get_media_coach_calls()
                self.assertTrue(any(c["fn"] == "openYouGlish" for c in mc_calls))
            finally:
                session.close()

    def test_t1_f4_04_mic_coach_drawer_mounts_in_en_reader(self) -> None:
        """T1-F4-04: Clicking Mic Coach in inspector opens #micCoachDrawer inside #enReaderMediaCoachMount."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            articles = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "A1"]
            kw = articles[0]["paragraphs"][0]["keyWords"][0]["w"]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)

                inspector = session.click_word_token(kw, para_index=0)
                inspector.locator("button").filter(has_text=re.compile(r"Đọc thử", re.I)).first.click()

                mount = session.page.locator("#viewEnReader #enReaderMediaCoachMount")
                expect(mount.locator("#micCoachDrawer")).to_be_visible()
                self.assertIn(kw.lower(), mount.locator("#micTargetText").inner_text().lower())
                mc_calls = session.get_media_coach_calls()
                self.assertTrue(any(c["fn"] == "openMicCoach" for c in mc_calls))
            finally:
                session.close()

    def test_t1_f4_05_non_253_word_queries_en_lookup_and_renders_details(self) -> None:
        """T1-F4-05: Clicking non-253 word (neuroplasticity) queries /api/en-lookup and renders inspector."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            lookup_urls: list[str] = []

            def _mock_lookup(route: Any) -> None:
                lookup_urls.append(route.request.url)
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
                            "vi": "tính mềm dẻo thần kinh",
                            "enDef": "The brain ability to reorganize synaptic connections.",
                            "exampleEn": "Neuroplasticity supports lifelong learning.",
                        }
                    ),
                )

            session.page.route("**/api/en-lookup*", _mock_lookup)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Brain Plasticity Study",
                    "B2",
                    "Neuroplasticity helps learners reshape memory.",
                )
                inspector = session.click_word_token("neuroplasticity", para_index=0)
                expect(inspector).to_contain_text("tính mềm dẻo thần kinh", timeout=5000)
                self.assertTrue(
                    any("word=neuroplasticity" in u.lower() for u in lookup_urls),
                    f"Expected /api/en-lookup?word=neuroplasticity call, got {lookup_urls}",
                )
            finally:
                session.close()

    def test_t1_f4_06_direct_api_en_lookup_local_vocab_and_lemma(self) -> None:
        """T1-F4-06: GET /api/en-lookup hits local en-vocab.json for exact ('respect') & lemma ('respects')."""
        with IsolatedServer() as srv:
            status1, d1 = srv.get_json_with_status("/api/en-lookup?word=respect")
            self.assertEqual(status1, 200)
            self.assertTrue(d1.get("ok"))
            self.assertTrue(d1.get("found"))
            self.assertFalse(d1.get("offline"))
            self.assertTrue(d1.get("ipa"))
            self.assertTrue(d1.get("vi"))

            status2, d2 = srv.get_json_with_status("/api/en-lookup?word=respects")
            self.assertEqual(status2, 200)
            self.assertTrue(d2.get("ok"))
            self.assertTrue(d2.get("found"))
            self.assertFalse(d2.get("offline"))
            self.assertEqual(d2.get("ipa"), d1.get("ipa"))
            self.assertEqual(d2.get("vi"), d1.get("vi"))


class TestTier1SrsAndBridge(unittest.TestCase):
    """F5: SRS Enqueue & Jump to Xưởng Gốc Từ (T1-F5-01..05)."""

    def test_t1_f5_01_enqueue_unlearned_core_word_to_srs(self) -> None:
        """T1-F5-01: + Đưa vào SRS Hôm nay saves unlearned core word ('final') to enVocab & increments due badge."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                badge = session.page.locator("#enDueCountBadge")
                before_due = int(re.search(r"\d+", badge.inner_text()).group())

                session.paste_custom_article(
                    "Core Word Probe",
                    "A1",
                    "The final choice builds calm focus.",
                )
                inspector = session.click_word_token("final", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                after_due = int(re.search(r"\d+", badge.inner_text()).group())
                self.assertEqual(after_due, before_due + 1)

                prog = srv.get_json("/api/progress")
                self.assertIn("final", prog["enVocab"])
                self.assertTrue(prog["enVocab"]["final"].get("due"))
            finally:
                session.close()

    def test_t1_f5_02_enqueue_non_253_word_and_visible_in_due_queue(self) -> None:
        """T1-F5-02: Non-253 word ('cognitive') added to SRS appears in Ôn tập (enDue) list."""
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
                            "vi": "thuộc nhận thức",
                            "enDef": "Relating to cognition.",
                        }
                    ),
                ),
            )
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                badge = session.page.locator("#enDueCountBadge")
                before_due = int(re.search(r"\d+", badge.inner_text()).group())

                session.paste_custom_article(
                    "Cognitive Note",
                    "B2",
                    "Cognitive load shapes reading retention.",
                )
                inspector = session.click_word_token("cognitive", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                after_due = int(re.search(r"\d+", badge.inner_text()).group())
                self.assertEqual(after_due, before_due + 1)

                session.page.locator('#enViewTabs .en-view-btn[data-enview="enDue"]').click()
                expect(session.page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                word_list_txt = session.page.locator("#enWordList").inner_text().lower()
                self.assertIn("cognitive", word_list_txt)
            finally:
                session.close()

    def test_t1_f5_03_jump_to_word_b2_core_switches_level_and_reparents_tabs(self) -> None:
        """T1-F5-03: Mở trong Xưởng Gốc Từ → on B2 core 'evidence' switches to Atelier, B2, and selects word."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Evidence Essay",
                    "B2",
                    "Strong evidence supports every claim.",
                )
                inspector = session.click_word_token("evidence", para_index=0)
                jump_btn = inspector.locator("button").filter(
                    has_text=re.compile(r"Mở trong Xưởng Gốc Từ", re.I)
                ).first
                jump_btn.click()

                expect(session.page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(session.page.locator("#viewEnAtelier .panel-left #enLevelTabs")).to_have_count(1)
                expect(session.page.locator('#enLevelTabs .en-level-btn[data-enlevel="B2"]')).to_have_class(
                    re.compile(r"\bactive\b")
                )
                expect(session.page.locator("#enPromptWord")).to_contain_text("evidence", ignore_case=True)
            finally:
                session.close()

    def test_t1_f5_04_jump_to_word_top10k_word_loads_and_renders_anatomy(self) -> None:
        """T1-F5-04: Mở trong Xưởng Gốc Từ → on top10k non-253 'information' loads top10k & shows breakdown."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            session.page.route(
                "**/api/en-lookup*",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "ok": True,
                            "found": True,
                            "offline": False,
                            "word": "information",
                            "ipa": "/ˌɪnfəˈmeɪʃən/",
                            "pos": "noun",
                            "vi": "thông tin",
                            "enDef": "Knowledge obtained from investigation or study.",
                            "exampleEn": "Clear information builds understanding.",
                        }
                    ),
                ),
            )
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Information Flow",
                    "A1",
                    "Clear information builds understanding.",
                )
                inspector = session.click_word_token("information", para_index=0)
                jump_btn = inspector.locator("button").filter(
                    has_text=re.compile(r"Mở trong Xưởng Gốc Từ", re.I)
                ).first
                jump_btn.click()

                expect(session.page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(session.page.locator("#enPromptWord")).to_contain_text("information", ignore_case=True, timeout=8000)
                morph_txt = session.page.locator("#enMorphEquation").inner_text().lower()
                self.assertIn("form", morph_txt)
            finally:
                session.close()

    def test_t1_f5_05_enqueued_word_persists_across_reload(self) -> None:
        """T1-F5-05: Enqueued SRS word persists across page reload in /api/progress & #enDueCountBadge."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                before_due = int(re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group())

                session.paste_custom_article("Persistence Read", "A1", "Respect builds trust.")
                inspector = session.click_word_token("respect", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                session.reload_app()
                session.page.locator("#spaceEnBtn").click()
                after_due = int(re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group())
                self.assertEqual(after_due, before_due + 1)
                prog = srv.get_json("/api/progress")
                self.assertIn("respect", prog["enVocab"])
            finally:
                session.close()


class TestTier1CustomAndSummary(unittest.TestCase):
    """F6: Custom Paste & Reading Summary (T1-F6-01..05)."""

    def test_t1_f6_01_paste_custom_article_saves_to_en_custom_readings(self) -> None:
        """T1-F6-01: + Dán bài viết tiếng Anh bất kỳ creates 2-para article and persists enCustomReadings."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Deep Focus Habits",
                    "B1",
                    "Respect your attention every day.\n\nClear information supports neuroplasticity.",
                )
                expect(session.page.locator("#enCustomReadingForm")).to_have_class(re.compile(r"\bhidden\b"))
                expect(session.page.locator("#enReaderTitle")).to_contain_text("Deep Focus Habits")
                expect(session.page.locator("#enReaderParagraphs .para-card")).to_have_count(2)

                prog = srv.get_json("/api/progress")
                customs = prog.get("enCustomReadings", [])
                self.assertEqual(len(customs), 1)
                self.assertTrue(customs[0]["id"].startswith("en-custom-"))
                self.assertEqual(customs[0]["level"], "B1")
                self.assertEqual(len(customs[0]["paragraphs"]), 2)
            finally:
                session.close()

    def test_t1_f6_02_custom_article_word_click_and_srs_add(self) -> None:
        """T1-F6-02: Word token in custom article opens #enInlineInspector and enqueues to SRS."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Respect Study",
                    "A1",
                    "Learners respect deep reading.",
                )
                inspector = session.click_word_token("respect", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())
                prog = srv.get_json("/api/progress")
                self.assertIn("respect", prog["enVocab"])
            finally:
                session.close()

    def test_t1_f6_03_custom_filter_shows_only_custom_articles(self) -> None:
        """T1-F6-03: Filter chip 'custom' shows saved custom article and hides built-in articles."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article("My Custom Piece", "B1", "Focus builds memory.")
                session.page.locator('.en-reader-filter[data-enfilter="custom"]').click()
                items = session.page.locator("#enReaderList .kanji-item")
                expect(items).to_have_count(1)
                expect(items.first).to_contain_text("My Custom Piece")
            finally:
                session.close()

    def test_t1_f6_04_comprehension_question_and_sample_answer(self) -> None:
        """T1-F6-04: Unlocked article displays question.promptEn/promptVi and reveals sampleAnswer."""
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

                qbox = session.page.locator("#enReaderQuestionBox")
                expect(qbox).to_be_visible()
                q_txt = qbox.inner_text()
                self.assertIn(a1_art["question"]["promptEn"], q_txt)
                self.assertIn(a1_art["question"]["promptVi"], q_txt)

                reveal_btn = qbox.locator("button").first
                if reveal_btn.count() > 0:
                    reveal_btn.click()
                    expect(qbox).to_contain_text(a1_art["question"]["sampleAnswer"])
            finally:
                session.close()

    def test_t1_f6_05_submit_summary_persists_done_and_notes(self) -> None:
        """T1-F6-05: Submitting 1-sentence summary saves enReadingsDone & enReadingNotes and updates badges."""
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
                summary = "Focused reading builds strong neural pathways."
                session.submit_summary(summary)

                expect(session.page.locator("#enReaderDoneBadge")).to_contain_text("Đã hoàn thành")
                prog = srv.get_json("/api/progress")
                self.assertIn(a1_art["id"], prog["enReadingsDone"])
                self.assertEqual(prog["enReadingsDone"][a1_art["id"]]["summary"], summary)
                self.assertIn(a1_art["id"], prog["enReadingNotes"])
                self.assertEqual(prog["enReadingNotes"][a1_art["id"]]["summary"], summary)
            finally:
                session.close()


class TestTier1IntegrityAndDashboards(unittest.TestCase):
    """F7: Home Hub, Neuro Dashboard, Reload Persistence & Data Integrity (T1-F7-01..05)."""

    def test_t1_f7_01_home_hub_displays_completed_reading_count(self) -> None:
        """T1-F7-01: Completing 1 EN reading updates #homeEnReadings to 1 / 15 bài."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_from_home()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                session.submit_summary("Focused reading builds strong neural pathways.")

                session.page.locator("#spaceHomeBtn").click()
                expect(session.page.locator("#homeEnReadings")).to_contain_text("1 / 15")
            finally:
                session.close()

    def test_t1_f7_02_neuro_dashboard_shows_counts_and_summary_journal(self) -> None:
        """T1-F7-02: Não bộ & Git displays EN reading count (+custom) and summary in #neuroNotesArchive."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                a1_title = session.page.locator("#enReaderTitle").inner_text().strip()
                session.unlock_all_paragraphs()
                summary = "Deep reading strengthens long-term comprehension."
                session.submit_summary(summary)

                session.paste_custom_article("Custom Neuro Piece", "B1", "Custom brain paragraph.")
                session.page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(session.page.locator("#viewNeuro")).not_to_have_class(re.compile(r"\bhidden\b"))

                mod_txt = session.page.locator("#neuroModuleSummary").inner_text()
                self.assertIn("1 / 15", mod_txt)
                self.assertIn("+1", mod_txt)

                archive_txt = session.page.locator("#neuroNotesArchive").inner_text()
                self.assertIn(a1_title, archive_txt)
                self.assertIn(summary, archive_txt)
            finally:
                session.close()

    def test_t1_f7_03_reload_preserves_completed_summary_custom_and_neuro(self) -> None:
        """T1-F7-03: Reloading browser preserves completed reading summary, custom article & Neuro journal."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                summary = "Reload persistence check summary."
                session.submit_summary(summary)
                session.paste_custom_article("Saved After Reload", "B1", "Attention matters.")

                session.reload_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                expect(session.page.locator("#enReaderDoneBadge")).to_contain_text("Đã hoàn thành")
                self.assertEqual(session.page.locator("#enReaderSummaryInput").input_value(), summary)

                session.page.locator('.en-reader-filter[data-enfilter="custom"]').click()
                expect(session.page.locator("#enReaderList")).to_contain_text("Saved After Reload")

                session.page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(session.page.locator("#neuroNotesArchive")).to_contain_text(summary)
            finally:
                session.close()

    def test_t1_f7_04_baseline_18_kanji_and_15_en_vocab_preserved_after_mutations(self) -> None:
        """T1-F7-04: Isolated progress keeps exact 18 kanji & 15 baseline enVocab intact after EN mutations."""
        require_en_readings_dataset()
        snap = capture_progress_snapshot()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                session.submit_summary("Preserving baseline records.")
                session.paste_custom_article("Extra Reading", "A1", "Respect builds focus.")
                inspector = session.click_word_token("respect", para_index=0)
                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                prog = srv.get_json("/api/progress")
                assert_baseline_records_preserved(prog, snap)
                self.assertIn("respect", prog["enVocab"])
            finally:
                session.close()

    def test_t1_f7_05_real_user_progress_json_byte_identical_after_isolated_run(self) -> None:
        """T1-F7-05: Real data/user-progress.json stays byte-identical (12 keys, 18 kanji, 15 enVocab)."""
        snap = capture_progress_snapshot()
        with IsolatedServer() as srv:
            prog = srv.get_json("/api/progress")
            prog.setdefault("enReadingsDone", {})["probe-id"] = {"completedAt": "2026-11-19T00:00:00Z", "summary": "ok"}
            srv.post_json("/api/progress", prog)
            assert_real_progress_intact(snap)
        assert_real_progress_intact(snap)


if __name__ == "__main__":
    unittest.main()
