"""Tier 3 Cross-Feature Pairwise E2E Tests (T3-01..T3-08)."""

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
    capture_progress_snapshot,
    require_en_readings_dataset,
)

_BROWSER_MGR = BrowserManager()


def tearDownModule() -> None:
    _BROWSER_MGR.close()


class TestTier3CrossFeaturePairwise(unittest.TestCase):
    """T3-01..T3-08: Pairwise interactions across F1–F7."""

    def test_t3_01_custom_paste_inspector_srs_jump_and_level_tab_return(self) -> None:
        """T3-01: Custom Paste -> Inflected Inspector -> SRS -> Jump B2 Evidence -> Return Reparents Tabs."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Pairwise T3-01",
                    "B2",
                    "A learner respects solid evidence in deep study.",
                )

                ins1 = session.click_word_token("respects", para_index=0)
                add_btn = ins1.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                ins2 = session.click_word_token("evidence", para_index=0)
                ins2.locator("button").filter(
                    has_text=re.compile(r"Mở trong Xưởng Gốc Từ", re.I)
                ).first.click()

                page = session.page
                expect(page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#enPromptWord")).to_contain_text("evidence", ignore_case=True)
                expect(page.locator('#enLevelTabs .en-level-btn[data-enlevel="B2"]')).to_have_class(
                    re.compile(r"\bactive\b")
                )

                page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]').click()
                expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_have_count(1)

                prog = srv.get_json("/api/progress")
                self.assertEqual(len(prog["enCustomReadings"]), 1)
                self.assertIn("respect", prog["enVocab"])
            finally:
                session.close()

    def test_t3_02_antiskimming_audio_youglish_summary_home_and_neuro(self) -> None:
        """T3-02: Anti-Skimming -> Vi toggle -> UK 0.75x + YouGlish -> Summary -> Home & Neuro."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            a1_art = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "A1"][0]
            kw = a1_art["paragraphs"][0]["keyWords"][0]["w"]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)

                page = session.page
                page.locator("#enReaderTransAllBtn").click()
                expect(page.locator("#enReaderParagraphs .para-card").first.locator(".para-vi")).to_be_visible()

                session.clear_speech_calls()
                ins = session.click_word_token(kw, para_index=0)
                ins.locator("button").filter(has_text=re.compile(r"UK.*0\.75|0\.75.*UK", re.I)).first.click()
                calls = session.get_speech_calls()
                self.assertTrue(any(c["lang"] == "en-GB" and abs(c["rate"] - 0.75) < 0.05 for c in calls))

                ins.locator("button").filter(has_text=re.compile(r"YouGlish", re.I)).first.click()
                expect(page.locator("#viewEnReader #enReaderMediaCoachMount #youglishDrawer")).to_be_visible()

                session.unlock_all_paragraphs()
                summary = "UK audio and YouGlish integrated with summary."
                session.submit_summary(summary)

                page.locator("#spaceHomeBtn").click()
                expect(page.locator("#homeEnReadings")).to_contain_text("1 / 15")

                page.locator("#spaceEnBtn").click()
                page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(page.locator("#neuroNotesArchive")).to_contain_text(summary)
            finally:
                session.close()

    def test_t3_03_non_253_lookup_add_srs_due_grade_and_reload(self) -> None:
        """T3-03: Non-253 'cognitive' lookup -> Add SRS -> Ôn tập grade 3 -> Reload persists reps=1."""
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
                            "enDef": "Relating to mental processes.",
                        }
                    ),
                ),
            )
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article("Cognitive Flow", "B2", "Cognitive focus matters.")
                ins = session.click_word_token("cognitive", para_index=0)
                add_btn = ins.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                due_after_add = int(
                    re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group()
                )
                session.page.locator('#enViewTabs .en-view-btn[data-enview="enDue"]').click()
                item = session.page.locator("#enWordList .kanji-item").filter(
                    has_text=re.compile(r"\bcognitive\b", re.I)
                ).first
                expect(item).to_be_visible(timeout=5000)
                item.click()
                grade_btn = session.page.locator('#enStickySrsFooter .en-srs-btn[data-quality="3"]')
                session.wait_for_progress_save(lambda: grade_btn.click())

                session.reload_app()
                session.page.locator("#spaceEnBtn").click()
                due_after_reload = int(
                    re.search(r"\d+", session.page.locator("#enDueCountBadge").inner_text()).group()
                )
                self.assertEqual(due_after_reload, due_after_add - 1)
                prog = srv.get_json("/api/progress")
                self.assertEqual(prog["enVocab"]["cognitive"]["reps"], 1)
            finally:
                session.close()

    def test_t3_04_sidebar_collapse_custom_filter_search_and_full_mode(self) -> None:
        """T3-04: Collapse/Expand sidebar -> Custom filter -> Search custom title -> Full-article mode."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "UniquePairwiseTitle",
                    "B1",
                    "First deep reading paragraph.\n\nSecond deep reading paragraph.",
                )
                page = session.page
                page.locator("#enReaderToggleSidebarBtn").click()
                expect(page.locator("#viewEnReader")).to_have_class(re.compile(r"\bsidebar-collapsed\b"))
                page.locator("#enReaderToggleSidebarBtn").click()
                expect(page.locator("#viewEnReader .panel-left")).to_be_visible()

                page.locator('.en-reader-filter[data-enfilter="custom"]').click()
                page.locator("#enReaderSearchInput").fill("UniquePairwiseTitle")
                expect(page.locator("#enReaderList .kanji-item")).to_have_count(1)
                page.locator("#enReaderList .kanji-item").first.click()

                page.locator("#enReaderModeToggleBtn").click()
                cards = page.locator("#enReaderParagraphs .para-card")
                for i in range(cards.count()):
                    expect(cards.nth(i)).not_to_have_class(re.compile(r"\bblurred\b"))
                expect(page.locator("#enReaderSummaryBox")).to_be_visible()
            finally:
                session.close()

    def test_t3_05_cefr_a1_to_c1_switch_keywords_inspector_and_mic_coach(self) -> None:
        """T3-05: Switch A1 -> C1 -> open 1st C1 article -> inspect keyWord -> open Mic Coach."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            c1_arts = [a for a in srv.get_json("/data/en-readings.json") if a["level"] == "C1"]
            c1_kw = c1_arts[0]["paragraphs"][0]["keyWords"][0]
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.select_en_level("C1")
                session.open_article_at(0)
                expect(session.page.locator("#enReaderTitle")).to_contain_text(c1_arts[0]["title"])

                ins = session.click_word_token(c1_kw["w"], para_index=0)
                expect(ins).to_contain_text(c1_kw["ipa"])
                ins.locator("button").filter(has_text=re.compile(r"Đọc thử", re.I)).first.click()

                mount = session.page.locator("#viewEnReader #enReaderMediaCoachMount")
                expect(mount.locator("#micCoachDrawer")).to_be_visible()
                self.assertIn(c1_kw["w"].lower(), mount.locator("#micTargetText").inner_text().lower())
            finally:
                session.close()

    def test_t3_06_home_quick_entry_srs_enqueue_syncs_home_totals(self) -> None:
        """T3-06: Home quick entry -> add unlearned core 'final' to SRS -> Home due & learned sync."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                page = session.page
                before_en_due = int(re.search(r"\d+", page.locator("#homeEnDue").inner_text()).group())
                before_total_due = int(
                    re.search(r"\d+", page.locator("#homeStatTotalDue").inner_text()).group()
                )

                session.open_en_reader_from_home()
                session.paste_custom_article("Home Sync Check", "A1", "The final goal is clarity.")
                ins = session.click_word_token("final", para_index=0)
                add_btn = ins.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                page.locator("#spaceHomeBtn").click()
                after_en_due = int(re.search(r"\d+", page.locator("#homeEnDue").inner_text()).group())
                after_total_due = int(
                    re.search(r"\d+", page.locator("#homeStatTotalDue").inner_text()).group()
                )
                self.assertEqual(after_en_due, before_en_due + 1)
                self.assertEqual(after_total_due, before_total_due + 1)
                expect(page.locator("#homeEnLearned")).to_contain_text("16 / 253")
            finally:
                session.close()

    def test_t3_07_offline_fallback_custom_summary_and_baseline_integrity(self) -> None:
        """T3-07: Offline lookup fallback for 'epistemology' + custom summary keeps 18 kanji / 15 enVocab."""
        require_en_readings_dataset()
        snap = capture_progress_snapshot()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            session.page.route("**/api/en-lookup*", lambda r: r.abort("internetdisconnected"))
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                session.paste_custom_article(
                    "Offline Epistemology",
                    "C1",
                    "Epistemology studies knowledge.",
                )
                ins = session.click_word_token("epistemology", para_index=0)
                self.assertNotIn("undefined", ins.inner_text().lower())

                session.unlock_all_paragraphs()
                session.submit_summary("Studied epistemology offline cleanly.")

                prog = srv.get_json("/api/progress")
                assert_baseline_records_preserved(prog, snap)
                self.assertEqual(len(prog["enReadingsDone"]), 1)
                self.assertEqual(len(prog["enReadingNotes"]), 1)
            finally:
                session.close()

    def test_t3_08_jp_deep_reader_and_en_deep_reader_coexist_in_neuro(self) -> None:
        """T3-08: Completing 1 EN reading + 1 JP reading shows both cleanly in Neuro & preserves both."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                # Complete 1 EN reading
                session.open_en_reader_via_tab()
                session.select_en_level("A1")
                session.open_article_at(0)
                session.unlock_all_paragraphs()
                en_sum = "EN coexistence summary."
                session.submit_summary(en_sum)

                # Complete 1 JP reading via JP space
                page = session.page
                page.locator("#spaceJpBtn").click()
                page.locator('#jpViewTabs .view-btn[data-view="reader"]').click()
                expect(page.locator("#readerList .kanji-item").first).to_be_visible(timeout=8000)
                page.locator("#readerList .kanji-item").first.click()
                for _ in range(12):
                    if page.locator("#readerSummaryBox").is_visible():
                        break
                    nxt = page.locator("#readerParagraphs .para-card.active button").filter(
                        has_text=re.compile(r"(Mở đoạn tiếp|Đã hiểu|Mở câu hỏi)", re.I)
                    )
                    if nxt.count() > 0 and nxt.first.is_visible():
                        nxt.first.click()
                    else:
                        break
                expect(page.locator("#readerSummaryBox")).to_be_visible(timeout=5000)
                jp_sum = "JP coexistence summary."
                page.locator("#readerSummaryInput").fill(jp_sum)
                session.wait_for_progress_save(lambda: page.locator("#readerCompleteBtn").click())

                page.locator('#jpViewTabs .view-btn[data-view="neuro"]').click()
                mod_txt = page.locator("#neuroModuleSummary").inner_text()
                self.assertIn("1 / 35", mod_txt)
                self.assertIn("1 / 15", mod_txt)
                arch_txt = page.locator("#neuroNotesArchive").inner_text()
                self.assertIn(en_sum, arch_txt)
                self.assertIn(jp_sum, arch_txt)
            finally:
                session.close()


if __name__ == "__main__":
    unittest.main()
