"""Tier 4 Real-World End-to-End Learner Scenarios (T4-01..T4-05)."""

from __future__ import annotations

import json
import re
import unittest

from playwright.sync_api import expect

from tests.harness import (
    BrowserManager,
    IsolatedServer,
    PlaywrightSession,
    assert_baseline_records_preserved,
    assert_real_progress_intact,
    capture_progress_snapshot,
    require_en_readings_dataset,
)

_BROWSER_MGR = BrowserManager()


def tearDownModule() -> None:
    _BROWSER_MGR.close()


class TestTier4RealWorldScenarios(unittest.TestCase):
    """T4-01..T4-05: Multi-step real learner journeys."""

    def test_t4_01_daily_beginner_flow_a1_to_home(self) -> None:
        """T4-01: Home -> Đọc sâu Tiếng Anh -> A1 Para 1 + Vi -> 2 words US/UK + SRS -> summary -> Home."""
        require_en_readings_dataset()
        snap = capture_progress_snapshot()
        with IsolatedServer() as srv:
            a1_art = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "A1"][0]
            kw = a1_art["paragraphs"][0]["keyWords"][0]["w"]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                page = session.page
                expect(page.locator("#homeEnReadings")).to_contain_text("0 / 15")
                before_home_due = int(re.search(r"\d+", page.locator("#homeEnDue").inner_text()).group())

                session.open_en_reader_from_home()
                session.select_en_level("A1")
                session.open_article_at(0)

                # Toggle Vi on para 1
                page.locator("#enReaderParagraphs .para-card").first.locator("button").filter(
                    has_text=re.compile(r"dịch", re.I)
                ).first.click()
                expect(page.locator("#enReaderParagraphs .para-card").first.locator(".para-vi")).to_be_visible()

                # Inspect word, play US 1.0x & UK 0.75x
                ins1 = session.click_word_token(kw, para_index=0)
                session.clear_speech_calls()
                ins1.locator("button").filter(has_text=re.compile(r"US", re.I)).filter(
                    has_not_text=re.compile(r"0\.75")
                ).first.click()
                ins1.locator("button").filter(has_text=re.compile(r"UK.*0\.75|0\.75.*UK", re.I)).first.click()
                calls = session.get_speech_calls()
                self.assertTrue(any(c["lang"] == "en-US" and abs(c["rate"] - 1.0) < 0.05 for c in calls))
                self.assertTrue(any(c["lang"] == "en-GB" and abs(c["rate"] - 0.75) < 0.05 for c in calls))

                # Unlock all paragraphs, reveal sample answer, submit summary
                session.unlock_all_paragraphs()
                qbox = page.locator("#enReaderQuestionBox")
                if qbox.locator("button").count() > 0:
                    qbox.locator("button").first.click()
                    expect(qbox).to_contain_text(a1_art["question"]["sampleAnswer"])

                # Add an unlearned core word if not already learned, via custom/known token or kw
                # Ensure due increments by at least 1 if kw was unlearned, else add 'final' in custom check
                if kw.lower() not in snap.data["enVocab"]:
                    add_btn = ins1.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                    session.wait_for_progress_save(lambda: add_btn.click())

                session.submit_summary("Beginner daily A1 reading completed.")
                page.locator("#spaceHomeBtn").click()
                expect(page.locator("#homeEnReadings")).to_contain_text("1 / 15")
                after_home_due = int(re.search(r"\d+", page.locator("#homeEnDue").inner_text()).group())
                if kw.lower() not in snap.data["enVocab"]:
                    self.assertEqual(after_home_due, before_home_due + 1)

                prog = srv.get_json("/api/progress")
                self.assertIn(a1_art["id"], prog["enReadingsDone"])
                assert_baseline_records_preserved(prog, snap)
            finally:
                session.close()
        assert_real_progress_intact(snap)

    def test_t4_02_intermediate_vocab_mining_b2_jump_atelier_blind_spelling_and_return(self) -> None:
        """T4-02: 3. Đọc sâu B2 -> Full-article -> inspect B2 word -> Jump Atelier -> Blind Spelling -> Return."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            b2_arts = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "B2"]
            b2_kw = b2_arts[0]["paragraphs"][0]["keyWords"][0]["w"]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("B2")
                session.open_article_at(0)

                page = session.page
                page.locator("#enReaderModeToggleBtn").click()
                ins = session.click_word_token(b2_kw, para_index=0)
                ins.locator("button").filter(
                    has_text=re.compile(r"Mở trong Xưởng Gốc Từ", re.I)
                ).first.click()

                expect(page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#enPromptWord")).to_contain_text(b2_kw, ignore_case=True)

                # Switch to Mode 3 Blind Spelling
                blind_btn = page.locator("#viewEnAtelier button").filter(
                    has_text=re.compile(r"Chính tả mù", re.I)
                ).first
                blind_btn.click()
                expect(page.locator("#enModeSpelling")).not_to_have_class(re.compile(r"\bhidden\b"))

                # Return to 3. Đọc sâu
                page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]').click()
                expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_have_count(1)
            finally:
                session.close()

    def test_t4_03_custom_article_study_3_token_tiers_srs_grade_and_reload(self) -> None:
        """T4-03: Custom Paste -> respects (lemma) + information (top10k) + neuroplasticity (rare) -> SRS -> Ôn tập."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)

            def _mock_lookup(route: Any) -> None:
                if "neuroplasticity" in route.request.url.lower():
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
                                "enDef": "Brain adaptability.",
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
                                "word": "information",
                                "ipa": "/ˌɪnfərˈmeɪʃən/",
                                "pos": "noun",
                                "vi": "thông tin",
                                "enDef": "Facts provided or learned.",
                            }
                        ),
                    )

            session.page.route("**/api/en-lookup*", _mock_lookup)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Neuroscience Excerpt",
                    "C1",
                    "A deep learner respects slow study.\n\nMeaningful information accelerates neuroplasticity.",
                )

                # Tier 1: inflected core 'respects'
                ins_r = session.click_word_token("respects", para_index=0)
                expect(ins_r).to_contain_text("tôn trọng", ignore_case=True)

                session.unlock_all_paragraphs()
                # Tier 2: top10k 'information' -> SRS
                ins_i = session.click_word_token("information", para_index=1)
                btn_i = ins_i.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: btn_i.click())

                # Tier 3: rare 'neuroplasticity' -> SRS
                ins_n = session.click_word_token("neuroplasticity", para_index=1)
                btn_n = ins_n.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: btn_n.click())

                # Review & grade both in Ôn tập
                session.page.locator('#enViewTabs .en-view-btn[data-enview="enDue"]').click()
                for word in ("information", "neuroplasticity"):
                    item = session.page.locator("#enWordList .kanji-item").filter(
                        has_text=re.compile(rf"\b{word}\b", re.I)
                    ).first
                    expect(item).to_be_visible(timeout=5000)
                    item.click()
                    grade_btn = session.page.locator('#enStickySrsFooter .en-srs-btn[data-quality="3"]')
                    session.wait_for_progress_save(lambda: grade_btn.click())

                session.reload_app()
                prog = srv.get_json("/api/progress")
                self.assertEqual(len(prog["enCustomReadings"]), 1)
                self.assertEqual(prog["enVocab"]["information"]["reps"], 1)
                self.assertEqual(prog["enVocab"]["neuroplasticity"]["reps"], 1)
            finally:
                session.close()

    def test_t4_04_multi_level_study_session_and_neuro_summary_journal(self) -> None:
        """T4-04: Complete A1 + B2 + custom C1 readings -> Neuro summary & journal -> survive reload."""
        require_en_readings_dataset()
        snap = capture_progress_snapshot()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()

                # 1. A1 reading
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                sum_a = "Summary A from A1 reading."
                session.submit_summary(sum_a)

                # 2. B2 reading
                session.select_en_level("B2")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                sum_b = "Summary B from B2 reading."
                session.submit_summary(sum_b)

                # 3. Custom C1 reading
                session.paste_custom_article("Custom C1 Synthesis", "C1", "Linguistics and cognition.")
                session.unlock_all_paragraphs()
                sum_c = "Summary C from custom C1 reading."
                session.submit_summary(sum_c)

                session.page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(session.page.locator("#neuroModuleSummary")).to_contain_text("2 / 15")
                expect(session.page.locator("#neuroModuleSummary")).to_contain_text("+1")
                arch = session.page.locator("#neuroNotesArchive")
                expect(arch).to_contain_text(sum_a)
                expect(arch).to_contain_text(sum_b)
                expect(arch).to_contain_text(sum_c)

                session.reload_app()
                session.page.locator("#spaceEnBtn").click()
                session.page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(session.page.locator("#neuroNotesArchive")).to_contain_text(sum_a)
                expect(session.page.locator("#neuroNotesArchive")).to_contain_text(sum_b)
                expect(session.page.locator("#neuroNotesArchive")).to_contain_text(sum_c)

                prog = srv.get_json("/api/progress")
                assert_baseline_records_preserved(prog, snap)
            finally:
                session.close()

    def test_t4_05_distraction_free_sidebar_collapse_and_keyboard_safety(self) -> None:
        """T4-05: Collapse sidebar for 940px reading -> type '1234[]' in summary & search -> zero SRS side effects."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            before_prog = srv.get_json("/api/progress")
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)

                page = session.page
                page.locator("#enReaderToggleSidebarBtn").click()
                expect(page.locator("#viewEnReader")).to_have_class(re.compile(r"\bsidebar-collapsed\b"))
                box = page.locator("#enReaderArticleWrap").bounding_box()
                assert box is not None
                self.assertGreater(box["width"], 720.0)
                self.assertLessEqual(box["width"], 942.0)

                session.unlock_all_paragraphs()
                summary_text = "Focus summary 1234 with [note] inside."
                page.locator("#enReaderSummaryInput").click()
                page.keyboard.type(summary_text)
                self.assertEqual(page.locator("#enReaderSummaryInput").input_value(), summary_text)
                session.wait_for_progress_save(lambda: page.locator("#enReaderCompleteBtn").click())

                page.locator("#enReaderToggleSidebarBtn").click()
                expect(page.locator("#viewEnReader .panel-left")).to_be_visible()
                page.locator("#enReaderSearchInput").click()
                page.keyboard.type("1234[]")
                self.assertEqual(page.locator("#enReaderSearchInput").input_value(), "1234[]")

                after_prog = srv.get_json("/api/progress")
                self.assertEqual(after_prog["enVocab"], before_prog["enVocab"])
                self.assertEqual(len(after_prog["enReadingsDone"]), 1)
            finally:
                session.close()


if __name__ == "__main__":
    unittest.main()
