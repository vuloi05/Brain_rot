"""Isolated Playwright & HTTP E2E tests for Stage 0 (path fixes) and Stage 1 (Mimi Kara N3 in Textbook Library)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, expect, sync_playwright

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
SERVER_JS_PATH = ROOT_DIR / "server.js"
REAL_PROGRESS_PATH = DATA_DIR / "user-progress.json"


def _alloc_port() -> int:
    for _ in range(16):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            s.listen(1)
            p = int(s.getsockname()[1])
        if p != 3456:
            return p
    raise RuntimeError("No free non-3456 port")


class CustomIsolatedServer:
    """Starts server.js on ephemeral port + temp progress file; verifies real progress untouched."""

    def __init__(self, progress_data: dict[str, Any]) -> None:
        self.progress_data = progress_data
        self.real_bytes = REAL_PROGRESS_PATH.read_bytes()
        self.real_sha = hashlib.sha256(self.real_bytes).hexdigest()
        self.tmp_dir: tempfile.TemporaryDirectory[str] | None = None
        self.proc: subprocess.Popen[str] | None = None
        self.port = 0
        self.base_url = ""
        self._stdout: list[str] = []
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "CustomIsolatedServer":
        self.tmp_dir = tempfile.TemporaryDirectory(prefix="bokuseki_mimi_s1_")
        tmp_prog = Path(self.tmp_dir.name) / "user-progress.json"
        tmp_prog.write_text(json.dumps(self.progress_data, ensure_ascii=False, indent=2), encoding="utf-8")
        self.port = _alloc_port()
        self.base_url = f"http://127.0.0.1:{self.port}"

        env = {
            **os.environ,
            "PORT": str(self.port),
            "BOKUSEKI_PROGRESS_FILE": str(tmp_prog),
        }
        self.proc = subprocess.Popen(
            ["node", str(SERVER_JS_PATH)],
            cwd=str(ROOT_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        def _drain() -> None:
            assert self.proc is not None and self.proc.stdout is not None
            for line in self.proc.stdout:
                self._stdout.append(line.rstrip("\r\n"))

        self._thread = threading.Thread(target=_drain, daemon=True)
        self._thread.start()

        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(f"{self.base_url}/api/progress", timeout=1.0) as resp:
                    if resp.status == 200:
                        return self
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("Isolated server failed to start:\n" + "\n".join(self._stdout))

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait(timeout=4)
            if self._thread:
                self._thread.join(timeout=2)
            if self.proc and self.proc.stdout:
                self.proc.stdout.close()
        finally:
            if self.tmp_dir:
                try:
                    self.tmp_dir.cleanup()
                except OSError:
                    pass
            after = REAL_PROGRESS_PATH.read_bytes()
            assert hashlib.sha256(after).hexdigest() == self.real_sha, "Real user-progress.json mutated!"

    def get_progress(self) -> dict[str, Any]:
        with urllib.request.urlopen(f"{self.base_url}/api/progress", timeout=3.0) as resp:
            return json.loads(resp.read().decode("utf-8"))


def _make_base_progress() -> dict[str, Any]:
    return {
        "version": 1,
        "createdAt": "2026-11-17T00:00:00.000Z",
        "updatedAt": "2026-11-17T00:00:00.000Z",
        "settings": {"theme": "washi", "level": 3, "dailyNewLimit": 10},
        "stats": {"totalFocusSeconds": 600},
        "kanji": {},
        "enVocab": {},
        "readingsDone": {},
        "customReadings": [],
        "enReadingsDone": {},
        "enReadingNotes": {},
        "enCustomReadings": [],
        "sentencesDone": {},
        "examNotes": {},
        "sessionLogs": [],
    }


class TestMimiStage0And1(unittest.TestCase):
    _pw: Any = None
    _browser: Browser | None = None

    @classmethod
    def setUpClass(cls) -> None:
        cls._pw = sync_playwright().start()
        cls._browser = cls._pw.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._browser:
            cls._browser.close()
        if cls._pw:
            cls._pw.stop()

    def test_01_static_assets_chukyu_and_mimi_http_ok(self) -> None:
        """All tai_lieu_tieng_nhat/ paths (Chukyu PDF/Guide/MP3 and Mimi Kara N3 PDF) serve HTTP 200/206."""
        tb = json.loads((DATA_DIR / "textbooks.json").read_text(encoding="utf-8"))
        mimi = json.loads((DATA_DIR / "mimi-n3-book.json").read_text(encoding="utf-8"))
        self.assertNotIn("sach_pdf/", json.dumps(tb))
        self.assertEqual(sum(u["wordCount"] for u in mimi["units"]), 880)

        with CustomIsolatedServer(_make_base_progress()) as srv:
            urls = [
                "/data/mimi-n3-book.json",
                "/" + urllib.parse.quote(tb["pdfUrl"], safe="/"),
                "/" + urllib.parse.quote(tb["guidePdfUrl"], safe="/"),
                "/" + urllib.parse.quote(tb["lessons"][0]["audioSlow"], safe="/"),
                "/" + urllib.parse.quote(mimi["pdfUrl"], safe="/"),
            ]
            for u in urls:
                req = urllib.request.Request(f"{srv.base_url}{u}", method="HEAD")
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    self.assertEqual(resp.status, 200, f"Expected HTTP 200 for {u}")

            # Verify HTTP Range 206 streaming for Chukyu audio MP3
            audio_u = "/" + urllib.parse.quote(tb["lessons"][0]["audioSlow"], safe="/")
            req_rng = urllib.request.Request(f"{srv.base_url}{audio_u}", headers={"Range": "bytes=0-1023"})
            with urllib.request.urlopen(req_rng, timeout=5.0) as resp:
                self.assertEqual(resp.status, 206)
                self.assertEqual(len(resp.read()), 1024)

    def test_02_textbook_library_switch_mimi_unit_navigation_and_neuro_sync(self) -> None:
        """Switch Chukyu <-> Mimi N3, filter Steps, jump Unit/Column/Practice/Answers/Custom page, persist to Neuro."""
        assert self._browser is not None
        with CustomIsolatedServer(_make_base_progress()) as srv:
            ctx = self._browser.new_context(viewport={"width": 1280, "height": 860})
            page = ctx.new_page()
            errors: list[str] = []
            dialogs: list[str] = []
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
            page.route("https://fonts.googleapis.com/**", lambda r: r.abort())
            page.route("https://fonts.gstatic.com/**", lambda r: r.abort())

            try:
                page.goto(srv.base_url, wait_until="domcontentloaded")
                page.wait_for_function("() => Boolean(window.BokusekiApp && document.querySelector('#spaceJpBtn'))")

                # Open JP -> Exams -> 2. Sách giáo trình
                page.locator("#spaceJpBtn").click()
                page.locator('#jpViewTabs .view-btn[data-view="exams"]').click()
                page.locator('.exam-mode-btn[data-emode="textbook"]').click()

                # Verify Chukyu stays intact first
                expect(page.locator('#tbBookSwitchRow .tb-book-btn[data-tbbook="chukyu"]')).to_have_class(re.compile(r"\bactive\b"))
                expect(page.locator("#examList .kanji-item")).to_have_count(11)  # 10 lessons + GV
                expect(page.locator("#tbLessonKanjiSection")).to_be_visible()
                expect(page.locator("#examAudioBar")).to_be_visible()
                expect(page.locator("#tbPageJumpForm")).to_be_hidden()

                # Switch to Mimi Kara N3
                page.locator('#tbBookSwitchRow .tb-book-btn[data-tbbook="mimi-n3"]').click()
                expect(page.locator('#tbBookSwitchRow .tb-book-btn[data-tbbook="mimi-n3"]')).to_have_class(re.compile(r"\bactive\b"))
                expect(page.locator("#examList .kanji-item")).to_have_count(13)  # 12 units + 50-on index
                expect(page.locator("#tbMimiStepRow")).to_be_visible()
                expect(page.locator("#tbPageJumpForm")).to_be_visible()
                expect(page.locator("#tbMimiUnitInfoSection")).to_be_visible()
                expect(page.locator("#tbLessonKanjiSection")).to_be_hidden()
                expect(page.locator("#examAudioBar")).to_be_hidden()

                # Wait 80ms for setTimeout -> #examPdfFrame.src = ...#page=9
                page.wait_for_timeout(120)
                expect(page.locator("#examPdfFrame")).to_have_attribute("src", re.compile(r"Mimi_Kara_Oboeru_N3-Goi\.pdf#page=9$"))
                expect(page.locator("#examGuardBanner")).to_be_hidden()

                # Test Step filters
                page.locator('#tbMimiStepRow .mimi-step-filter[data-step="2"]').click()
                expect(page.locator("#examList .kanji-item")).to_have_count(6)  # U04..U08 + ref
                page.locator('#tbMimiStepRow .mimi-step-filter[data-step="3"]').click()
                expect(page.locator("#examList .kanji-item")).to_have_count(5)  # U09..U12 + ref
                page.locator('#tbMimiStepRow .mimi-step-filter[data-step="1"]').click()
                expect(page.locator("#examList .kanji-item")).to_have_count(4)  # U01..U03 + ref
                page.locator('#tbMimiStepRow .mimi-step-filter[data-step="all"]').click()
                expect(page.locator("#examList .kanji-item")).to_have_count(13)

                # Click Unit 01, Practice I, Column C1, Answer sheet (with Guard Banner!), and custom page jump
                page.locator('#examList .kanji-item[data-mimi-id="mimi-n3-u01"]').click()
                page.locator("#tbSectionBar .tb-sec-btn").filter(has_text=re.compile(r"Luyện I \(1–71\)")).click()
                page.wait_for_timeout(100)
                expect(page.locator("#examPdfFrame")).to_have_attribute("src", re.compile(r"#page=19$"))
                expect(page.locator("#examGuardBanner")).to_be_hidden()

                page.locator("#tbMimiColumnsList .tb-mimi-col-btn").first.click()
                page.wait_for_timeout(100)
                expect(page.locator("#examPdfFrame")).to_have_attribute("src", re.compile(r"#page=16$"))

                page.locator("#tbSectionBar .tb-sec-btn.guard").first.click()
                page.wait_for_timeout(100)
                expect(page.locator("#examPdfFrame")).to_have_attribute("src", re.compile(r"#page=226$"))
                expect(page.locator("#examGuardBanner")).to_be_visible()

                # Page jump form: book page 54 (Matome) -> PDF page 55
                page.locator("#tbPageJumpInput").fill("54")
                page.locator("#tbPageJumpBtn").click()
                page.wait_for_timeout(100)
                expect(page.locator("#examPdfFrame")).to_have_attribute("src", re.compile(r"#page=55$"))
                expect(page.locator("#examGuardBanner")).to_be_hidden()

                # Switch to 50-on Reference Index
                page.locator('#examList .kanji-item[data-mimi-id="mimi-n3-ref"]').click()
                page.wait_for_timeout(100)
                expect(page.locator("#examPdfFrame")).to_have_attribute("src", re.compile(r"#page=207$"))

                # Go back to Unit 01, add note and mark Unit 01 complete -> verify persistence + Neuro dashboard
                page.locator('#examList .kanji-item[data-mimi-id="mimi-n3-u01"]').click()
                with page.expect_response(lambda r: r.url.endswith("/api/progress") and r.request.method == "POST", timeout=8000):
                    page.locator("#examNoteInput").fill("Da thuoc #1-50 va C1-C2 Unit 01")
                with page.expect_response(lambda r: r.url.endswith("/api/progress") and r.request.method == "POST", timeout=8000):
                    page.locator("#examToggleDoneBtn").click()

                expect(page.locator("#tbMimiUnitProgress")).to_contain_text("1 / 12 Unit")
                saved = srv.get_progress()
                self.assertTrue(saved["examNotes"]["mimi-n3-u01"]["done"])
                self.assertEqual(saved["examNotes"]["mimi-n3-u01"]["note"], "Da thuoc #1-50 va C1-C2 Unit 01")

                # Reload and verify Neuro Dashboard reflects 1 / 12 Unit Mimi Kara N3 + archived note
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("() => Boolean(window.BokusekiApp && document.querySelector('#spaceJpBtn'))")
                page.locator("#spaceJpBtn").click()
                page.locator('#jpViewTabs .view-btn[data-view="neuro"]').click()
                expect(page.locator("#neuroModuleSummary")).to_contain_text("1 / 12 Unit 耳から")
                expect(page.locator("#neuroNotesArchive")).to_contain_text("Unit 01: 名詞 A (Danh từ A)")
                expect(page.locator("#neuroNotesArchive")).to_contain_text("Da thuoc #1-50 va C1-C2 Unit 01")
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])


if __name__ == "__main__":
    unittest.main()
