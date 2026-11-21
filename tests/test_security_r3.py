"""Tier 5 / R3 Security, Input-Validation & Keydown-Safety E2E Tests."""

from __future__ import annotations

import http.client
import http.server
import json
import re
import threading
import unittest
from typing import Any

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

IMG_XSS_PAYLOAD = '<img src=x onerror="window.__xss=1">'
SCRIPT_XSS_PAYLOAD = '<script>window.__xss=1</script>'


def tearDownModule() -> None:
    _BROWSER_MGR.close()


def _raw_http_request(
    port: int,
    method: str,
    target: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5.0)
    try:
        conn.request(method, target, body=body, headers=headers or {})
        resp = conn.getresponse()
        raw = resp.read()
        hdrs = {k.lower(): v for k, v in resp.getheaders()}
        return resp.status, hdrs, raw
    finally:
        conn.close()


class TestR3XssAndKeydownSafety(unittest.TestCase):
    """R3 Browser Security (XSS escaping) & enReader Tab/Keydown Isolation Tests."""

    def test_r3_xss_custom_reading_and_summary_in_reader_and_neuro(self) -> None:
        """XSS payloads in custom title/body and 1-sentence summary never execute across Reader & Neuro."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                page = session.page

                xss_title = f"Audit {IMG_XSS_PAYLOAD} {SCRIPT_XSS_PAYLOAD}"
                xss_body = f"Respect {IMG_XSS_PAYLOAD} and {SCRIPT_XSS_PAYLOAD} in reading."
                session.paste_custom_article(xss_title, "B1", xss_body)

                self.assertIsNone(page.evaluate("() => window.__xss"))
                expect(page.locator("#enReaderList")).to_contain_text("Audit")
                expect(page.locator("#enReaderTitle")).to_contain_text("<img")
                expect(page.locator("#enReaderParagraphs")).to_contain_text("Respect")
                self.assertEqual(page.locator("#enReaderList img, #enReaderList script").count(), 0)
                self.assertEqual(page.locator("#enReaderTitle img, #enReaderTitle script").count(), 0)
                self.assertEqual(page.locator("#enReaderParagraphs img, #enReaderParagraphs script").count(), 0)

                session.unlock_all_paragraphs()
                xss_summary = f"Summary {IMG_XSS_PAYLOAD} {SCRIPT_XSS_PAYLOAD}"
                session.submit_summary(xss_summary)

                page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(page.locator("#viewNeuro")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#neuroNotesArchive")).to_contain_text("Summary")
                expect(page.locator("#neuroNotesArchive")).to_contain_text("<img")
                self.assertEqual(page.locator("#neuroNotesArchive img, #neuroNotesArchive script").count(), 0)
                self.assertIsNone(page.evaluate("() => window.__xss"))
            finally:
                session.close()

    def test_r3_xss_mocked_en_lookup_in_inspector_and_neuro_en_roster(self) -> None:
        """XSS payloads in mocked /api/en-lookup (vi/enDef/ipa/pos) stay escaped in Inspector & Neuro EN roster."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)

            def _mock_xss_lookup(route: Any) -> None:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "ok": True,
                            "found": True,
                            "offline": False,
                            "word": "neuroplasticity",
                            "ipa": f"/ipa/{IMG_XSS_PAYLOAD}",
                            "pos": f"noun {SCRIPT_XSS_PAYLOAD}",
                            "vi": f"nghĩa {IMG_XSS_PAYLOAD} {SCRIPT_XSS_PAYLOAD}",
                            "enDef": f"Definition {IMG_XSS_PAYLOAD}",
                            "exampleEn": "Neuroplasticity adapts.",
                        }
                    ),
                )

            session.page.route("**/api/en-lookup*", _mock_xss_lookup)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                page = session.page

                session.paste_custom_article(
                    "Lookup XSS Probe",
                    "B2",
                    "Neuroplasticity reshapes neural pathways.",
                )

                inspector = session.click_word_token("neuroplasticity", para_index=0)
                expect(inspector).to_contain_text("nghĩa", timeout=5000)
                expect(inspector).to_contain_text("<img")
                self.assertEqual(page.locator("#enInlineInspector img, #enInlineInspector script").count(), 0)
                self.assertIsNone(page.evaluate("() => window.__xss"))

                add_btn = inspector.locator("button").filter(has_text=re.compile(r"Đưa vào SRS", re.I)).first
                session.wait_for_progress_save(lambda: add_btn.click())

                prog = srv.get_json("/api/progress")
                self.assertIn("neuroplasticity", prog["enVocab"])
                self.assertIn("meta", prog["enVocab"]["neuroplasticity"])

                page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                expect(page.locator("#viewNeuro")).not_to_have_class(re.compile(r"\bhidden\b"))
                page.locator('#rosterTabEn, .roster-tab[data-rtab="en"]').first.click()

                roster = page.locator("#learnedKanjiRoster")
                expect(roster).to_contain_text("neuroplasticity")
                expect(roster).to_contain_text("<img")
                self.assertEqual(page.locator("#learnedKanjiRoster img, #learnedKanjiRoster script").count(), 0)
                self.assertIsNone(page.evaluate("() => window.__xss"))

                # Reload and verify persisted meta in Neuro EN roster also remains safely escaped
                session.reload_app()
                page.locator("#spaceEnBtn").click()
                page.locator('#enViewTabs .en-view-btn[data-enview="neuro"]').click()
                page.locator('#rosterTabEn, .roster-tab[data-rtab="en"]').first.click()
                expect(roster).to_contain_text("neuroplasticity")
                self.assertEqual(page.locator("#learnedKanjiRoster img, #learnedKanjiRoster script").count(), 0)
                self.assertIsNone(page.evaluate("() => window.__xss"))
            finally:
                session.close()

    def test_r3_en_reader_tab_level_buttons_and_word_token_keydown_safety(self) -> None:
        """#enLevelTabs stays in enReader and pressing 1/2/[/] on focused .en-word-token triggers no Atelier nav or SRS."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            before_prog = srv.get_json("/api/progress")
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                page = session.page

                page.locator("#spaceEnBtn").click()
                page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]').click()
                expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#viewEnAtelier")).to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#viewEnReader .panel-left #enLevelTabs")).to_have_count(1)
                expect(page.locator("#enReaderList .kanji-item").first).to_be_visible(timeout=8000)

                for lvl in ("A2", "B1", "B2", "C1", "A1"):
                    page.locator(f'#enLevelTabs .en-level-btn[data-enlevel="{lvl}"]').click()
                    expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
                    expect(page.locator("#viewEnAtelier")).to_have_class(re.compile(r"\bhidden\b"))
                    expect(page.locator("#enReaderList .kanji-item")).to_have_count(3, timeout=5000)

                session.open_article_at(0)
                initial_title = page.locator("#enReaderTitle").inner_text().strip()

                first_token = page.locator("#viewEnReader #enReaderParagraphs .en-word-token").first
                expect(first_token).to_be_visible()
                first_token.focus()
                is_token_focused = page.evaluate(
                    "() => Boolean(document.activeElement && document.activeElement.classList.contains('en-word-token'))"
                )
                self.assertTrue(is_token_focused, "Expected focus to remain on .en-word-token")

                for key in ("1", "2", "[", "]"):
                    page.keyboard.press(key)

                page.wait_for_timeout(450)
                expect(page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#viewEnAtelier")).to_have_class(re.compile(r"\bhidden\b"))
                self.assertEqual(page.locator("#enReaderTitle").inner_text().strip(), initial_title)

                after_prog = srv.get_json("/api/progress")
                self.assertEqual(after_prog["enVocab"], before_prog["enVocab"])
            finally:
                session.close()

    def test_r3_mediacoach_youglish_accent_preserves_reader_mount_and_pause_all_hides_on_atelier(self) -> None:
        """YouGlish accent click keeps drawer in #enReaderMediaCoachMount; switching to enAtelier leaves drawer hidden."""
        require_en_readings_dataset()
        with IsolatedServer() as srv:
            session = PlaywrightSession(_BROWSER_MGR.get_browser(), srv)
            try:
                session.goto_app()
                session.open_en_reader_via_tab()
                page = session.page

                session.open_article_at(0)
                first_token = page.locator("#viewEnReader #enReaderParagraphs .en-word-token.is-keyword").first
                expect(first_token).to_be_visible()
                first_token.click()
                inspector = page.locator("#viewEnReader #enInlineInspector")
                expect(inspector).to_be_visible(timeout=5000)

                yg_btn = inspector.locator("button").filter(has_text=re.compile(r"YouGlish", re.I)).first
                yg_btn.click()

                reader_drawer = page.locator("#viewEnReader #enReaderMediaCoachMount #sharedMediaCoachDrawer")
                expect(reader_drawer).to_have_count(1)
                expect(page.locator("#youglishDrawer")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#youglishDrawer")).to_be_visible()

                us_accent_btn = page.locator('#ygAccentGroup .yg-accent-btn[data-ygaccent="us"]')
                us_accent_btn.click()

                expect(reader_drawer).to_have_count(1)
                expect(page.locator("#youglishDrawer")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#youglishDrawer")).to_be_visible()
                expect(us_accent_btn).to_have_class(re.compile(r"\bactive\b"))

                mic_btn = inspector.locator("button").filter(has_text=re.compile(r"Đọc thử", re.I)).first
                mic_btn.click()
                expect(page.locator("#viewEnReader #enReaderMediaCoachMount #micCoachDrawer")).to_be_visible()

                page.locator('#enViewTabs .en-view-btn[data-enview="enAtelier"]').click()
                expect(page.locator("#viewEnAtelier")).not_to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#sharedMediaCoachDrawer")).to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#youglishDrawer")).to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#micCoachDrawer")).to_have_class(re.compile(r"\bhidden\b"))
            finally:
                session.close()


class TestR3ServerHttpSecurityAndValidation(unittest.TestCase):
    """R3 server.js HTTP path-traversal, .git block, header, and API payload validation tests."""

    def test_r3_server_path_traversal_git_block_and_nosniff_headers(self) -> None:
        """Traversal, case-insensitive .git, bad percent-encoding, and null-byte paths are blocked with nosniff."""
        with IsolatedServer() as srv:
            cases = [
                ("/../Brain_rot_evil/secret.txt", (400, 403, 404)),
                ("/../../server.js", (400, 403, 404)),
                ("/.GIT/HEAD", (403,)),
                ("/.git/config", (403,)),
                ("/.agents/secret.txt", (403,)),
                ("/%ZZ", (400,)),
                ("/index.html%00.js", (400,)),
            ]
            for req_target, expected_statuses in cases:
                status, hdrs, _ = _raw_http_request(srv.port, "GET", req_target)
                self.assertIn(
                    status,
                    expected_statuses,
                    f"Unexpected status {status} for {req_target!r}; expected {expected_statuses}",
                )
                self.assertNotIn(status, (200, 500), f"Dangerous status {status} for {req_target!r}")
                self.assertEqual(
                    hdrs.get("x-content-type-options"),
                    "nosniff",
                    f"Missing X-Content-Type-Options: nosniff on {req_target!r}",
                )

            ok_status, ok_hdrs, ok_body = _raw_http_request(srv.port, "GET", "/index.html")
            self.assertEqual(ok_status, 200)
            self.assertEqual(ok_hdrs.get("x-content-type-options"), "nosniff")
            self.assertIn(b"<!DOCTYPE html>", ok_body)

    def test_r3_server_post_progress_rejects_malformed_payloads_and_keeps_temp_intact(self) -> None:
        """POST /api/progress rejects invalid JSON, null, [], and wrong field types with 400 without corrupting file."""
        snap = capture_progress_snapshot()
        with IsolatedServer() as srv:
            before_tmp = srv.read_tmp_progress()
            bad_bodies = [
                b"{not-valid-json",
                b"null",
                b"[]",
                json.dumps({"kanji": "bad"}).encode("utf-8"),
                json.dumps({"enCustomReadings": "not-an-array"}).encode("utf-8"),
            ]
            for raw_body in bad_bodies:
                status, hdrs, resp_bytes = _raw_http_request(
                    srv.port,
                    "POST",
                    "/api/progress",
                    body=raw_body,
                    headers={"Content-Type": "application/json"},
                )
                self.assertEqual(status, 400, f"Expected 400 for body={raw_body!r}, got {status}: {resp_bytes!r}")
                self.assertEqual(hdrs.get("x-content-type-options"), "nosniff")
                parsed = json.loads(resp_bytes.decode("utf-8"))
                self.assertFalse(parsed.get("ok"))

            after_tmp = srv.read_tmp_progress()
            self.assertEqual(after_tmp, before_tmp)
            assert_baseline_records_preserved(after_tmp, snap)
            prog_via_http = srv.get_json("/api/progress")
            self.assertEqual(prog_via_http, before_tmp)

    def test_r3_server_api_en_lookup_validation_and_using_lemma(self) -> None:
        """GET /api/en-lookup validates inputs, resolves local lemmas offline, strips upstream HTML, and does not cache offline errors."""
        state = {"fail_mode": False}

        class _MockUpstreamHandler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                return

            def _send_json_bytes(self, status: int, raw: bytes, ctype: str = "application/json") -> None:
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    pass

            def do_GET(self) -> None:  # noqa: N802
                if state["fail_mode"]:
                    self._send_json_bytes(503, b'{"error":"upstream unavailable"}')
                    return
                if self.path.startswith("/dict/"):
                    word = self.path[len("/dict/"):].split("?", 1)[0]
                    payload = [
                        {
                            "word": word,
                            "phonetic": "/ˈjuːzɪŋ/",
                            "meanings": [
                                {
                                    "partOfSpeech": "verb",
                                    "definitions": [
                                        {
                                            "definition": "To utilize or employ.",
                                            "example": "Deep readers are using active recall.",
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                    self._send_json_bytes(200, json.dumps(payload).encode("utf-8"))
                    return
                if self.path.startswith("/gt"):
                    payload = [[["<b>sử dụng</b>", "using", None, None, 1]]]
                    self._send_json_bytes(
                        200,
                        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8",
                    )
                    return
                if self.path.startswith("/mm"):
                    payload = {"responseData": {"translatedText": "<i>sử dụng</i>"}}
                    self._send_json_bytes(
                        200,
                        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8",
                    )
                    return
                self._send_json_bytes(404, b'{"error":"not found"}')

        mock_srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _MockUpstreamHandler)
        mock_thread = threading.Thread(target=mock_srv.serve_forever, daemon=True)
        mock_thread.start()
        mock_base = f"http://127.0.0.1:{mock_srv.server_address[1]}"
        extra_env = {
            "BOKUSEKI_EN_DICT_BASE": f"{mock_base}/dict",
            "BOKUSEKI_EN_GT_BASE": f"{mock_base}/gt",
            "BOKUSEKI_EN_MM_BASE": f"{mock_base}/mm",
        }

        try:
            with IsolatedServer(extra_env=extra_env) as srv:
                st_bad, hdrs_bad, body_bad = _raw_http_request(srv.port, "GET", "/api/en-lookup?word=---")
                self.assertEqual(st_bad, 400)
                self.assertEqual(hdrs_bad.get("x-content-type-options"), "nosniff")
                j_bad = json.loads(body_bad.decode("utf-8"))
                self.assertFalse(j_bad.get("ok"))

                st_xss, hdrs_xss, body_xss = _raw_http_request(
                    srv.port,
                    "GET",
                    "/api/en-lookup?word=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
                )
                self.assertEqual(st_xss, 400)
                self.assertEqual(hdrs_xss.get("x-content-type-options"), "nosniff")
                j_xss = json.loads(body_xss.decode("utf-8"))
                self.assertFalse(j_xss.get("ok"))

                st_fin, hdrs_fin, body_fin = _raw_http_request(srv.port, "GET", "/api/en-lookup?word=fining")
                self.assertEqual(st_fin, 200)
                self.assertEqual(hdrs_fin.get("x-content-type-options"), "nosniff")
                j_fin = json.loads(body_fin.decode("utf-8"))
                self.assertTrue(j_fin.get("ok"))
                self.assertIs(j_fin.get("found"), True)
                self.assertIs(j_fin.get("offline"), False)
                self.assertEqual(j_fin.get("baseWord"), "fine")
                self.assertTrue(j_fin.get("vi"))

                st_lem, hdrs_lem, body_lem = _raw_http_request(srv.port, "GET", "/api/en-lookup?word=moving")
                self.assertEqual(st_lem, 200)
                self.assertEqual(hdrs_lem.get("x-content-type-options"), "nosniff")
                j_lem = json.loads(body_lem.decode("utf-8"))
                self.assertTrue(j_lem.get("ok"))
                self.assertIs(j_lem.get("found"), True)
                self.assertIs(j_lem.get("offline"), False)
                self.assertEqual(j_lem.get("baseWord"), "move")

                # First verify 503 upstream returns found=False, offline=True and is NOT cached
                state["fail_mode"] = True
                st_off, hdrs_off, body_off = _raw_http_request(srv.port, "GET", "/api/en-lookup?word=using")
                self.assertEqual(st_off, 200)
                self.assertEqual(hdrs_off.get("x-content-type-options"), "nosniff")
                j_off = json.loads(body_off.decode("utf-8"))
                self.assertTrue(j_off.get("ok"))
                self.assertIs(j_off.get("found"), False)
                self.assertIs(j_off.get("offline"), True)
                self.assertEqual(j_off.get("word"), "using")

                # Restore upstream; subsequent lookup must succeed (not poisoned by cached offline result)
                state["fail_mode"] = False
                st_ok, hdrs_ok, body_ok = _raw_http_request(srv.port, "GET", "/api/en-lookup?word=using")
                self.assertEqual(st_ok, 200)
                self.assertEqual(hdrs_ok.get("x-content-type-options"), "nosniff")
                j_ok = json.loads(body_ok.decode("utf-8"))
                self.assertTrue(j_ok.get("ok"))
                self.assertIs(j_ok.get("found"), True)
                self.assertIs(j_ok.get("offline"), False)
                self.assertEqual(j_ok.get("word"), "using")
                self.assertEqual(j_ok.get("vi"), "sử dụng")
        finally:
            mock_srv.shutdown()
            mock_srv.server_close()

    def test_r3_server_oversized_body_returns_413_and_git_save_message_validation(self) -> None:
        """POST /api/progress >5MB returns HTTP 413 cleanly; POST /api/git-save non-string message returns 400."""
        with IsolatedServer() as srv:
            before_tmp = srv.read_tmp_progress()
            oversized = b'{"pad":"' + (b"x" * (5 * 1024 * 1024 + 4096)) + b'"}'
            st_413, hdrs_413, body_413 = _raw_http_request(
                srv.port,
                "POST",
                "/api/progress",
                body=oversized,
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(st_413, 413)
            self.assertEqual(hdrs_413.get("x-content-type-options"), "nosniff")
            j_413 = json.loads(body_413.decode("utf-8"))
            self.assertFalse(j_413.get("ok"))
            self.assertEqual(srv.read_tmp_progress(), before_tmp)

            st_git, hdrs_git, body_git = _raw_http_request(
                srv.port,
                "POST",
                "/api/git-save",
                body=json.dumps({"message": 123}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(st_git, 400)
            self.assertEqual(hdrs_git.get("x-content-type-options"), "nosniff")
            j_git = json.loads(body_git.decode("utf-8"))
            self.assertFalse(j_git.get("ok"))
            self.assertIn("message", str(j_git.get("error", "")))


if __name__ == "__main__":
    unittest.main()
