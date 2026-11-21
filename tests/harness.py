"""Shared test harness, isolation guards, and Playwright helpers for 3. Đọc sâu E2E tests."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from playwright.sync_api import Browser, BrowserContext, Locator, Page, Playwright, expect, sync_playwright

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
SERVER_JS_PATH = ROOT_DIR / "server.js"
REAL_PROGRESS_PATH = DATA_DIR / "user-progress.json"
EN_READINGS_PATH = DATA_DIR / "en-readings.json"
EN_VOCAB_PATH = DATA_DIR / "en-vocab.json"
EN_ROOTS_PATH = DATA_DIR / "en-roots.json"
EN_TOP10K_PATH = DATA_DIR / "en-freq-top10k.json"

VIEWPORT = {"width": 1280, "height": 860}

EXPECTED_KANJI_COUNT = 18
EXPECTED_EN_VOCAB_COUNT = 15
EXPECTED_BASELINE_KEYS = frozenset(
    {
        "version",
        "createdAt",
        "updatedAt",
        "settings",
        "stats",
        "kanji",
        "enVocab",
        "readingsDone",
        "customReadings",
        "sentencesDone",
        "examNotes",
        "sessionLogs",
    }
)
BASELINE_EN_VOCAB_WORDS = frozenset(
    {
        "message",
        "video",
        "program",
        "report",
        "special",
        "form",
        "visit",
        "reply",
        "value",
        "different",
        "press",
        "course",
        "audio",
        "offer",
        "event",
    }
)


def is_dry_run() -> bool:
    """Return True only when BOKUSEKI_E2E_STRICT is explicitly set to '0'."""
    return os.environ.get("BOKUSEKI_E2E_STRICT", "1") == "0"


def allocate_free_port() -> int:
    """Bind an ephemeral localhost TCP port that is never 3456."""
    for _ in range(16):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            port = int(sock.getsockname()[1])
        if port != 3456:
            return port
    raise RuntimeError("Unable to allocate a non-3456 free port")


@dataclass(frozen=True)
class ProgressSnapshot:
    path: Path
    raw_bytes: bytes
    sha256: str
    data: dict[str, Any]


def capture_progress_snapshot(path: Path = REAL_PROGRESS_PATH) -> ProgressSnapshot:
    """Capture exact bytes, SHA-256, and parsed JSON of real data/user-progress.json."""
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    data = json.loads(raw.decode("utf-8"))
    return ProgressSnapshot(path=path, raw_bytes=raw, sha256=sha, data=data)


def assert_real_progress_intact(snapshot: ProgressSnapshot) -> None:
    """Fail if data/user-progress.json changed in bytes, SHA-256, or baseline counts."""
    after_bytes = snapshot.path.read_bytes()
    after_sha = hashlib.sha256(after_bytes).hexdigest()
    if after_sha != snapshot.sha256 or after_bytes != snapshot.raw_bytes:
        raise AssertionError(
            f"Real user-progress.json was mutated! SHA-256 {snapshot.sha256} -> {after_sha}"
        )
    after_data = json.loads(after_bytes.decode("utf-8"))
    missing_keys = EXPECTED_BASELINE_KEYS - set(after_data.keys())
    if missing_keys:
        raise AssertionError(f"Missing baseline keys in user-progress.json: {sorted(missing_keys)}")
    if len(after_data.get("kanji", {})) != EXPECTED_KANJI_COUNT:
        raise AssertionError(
            f"Expected {EXPECTED_KANJI_COUNT} kanji, found {len(after_data.get('kanji', {}))}"
        )
    if set(after_data["kanji"].keys()) != set(snapshot.data["kanji"].keys()):
        raise AssertionError("Kanji keys changed in user-progress.json")
    if len(after_data.get("enVocab", {})) != EXPECTED_EN_VOCAB_COUNT:
        raise AssertionError(
            f"Expected {EXPECTED_EN_VOCAB_COUNT} enVocab, found {len(after_data.get('enVocab', {}))}"
        )
    if set(after_data["enVocab"].keys()) != set(snapshot.data["enVocab"].keys()):
        raise AssertionError("enVocab keys changed in user-progress.json")


def assert_baseline_records_preserved(progress_data: dict[str, Any], snapshot: ProgressSnapshot) -> None:
    """Verify an isolated progress payload still preserves all 18 kanji & 15 baseline enVocab intact."""
    kanji = progress_data.get("kanji", {})
    if len(kanji) != EXPECTED_KANJI_COUNT or set(kanji.keys()) != set(snapshot.data["kanji"].keys()):
        raise AssertionError(f"Kanji baseline altered: {len(kanji)} != {EXPECTED_KANJI_COUNT}")
    for k, orig_val in snapshot.data["kanji"].items():
        if kanji.get(k) != orig_val:
            raise AssertionError(f"Baseline kanji '{k}' mutated: {orig_val} -> {kanji.get(k)}")

    en_vocab = progress_data.get("enVocab", {})
    for word, orig_rec in snapshot.data["enVocab"].items():
        if word not in en_vocab:
            raise AssertionError(f"Baseline enVocab word '{word}' was lost!")
        cur_rec = en_vocab[word]
        for field in ("reps", "interval", "ease", "writePasses", "blindPasses"):
            if cur_rec.get(field) != orig_rec.get(field):
                raise AssertionError(
                    f"Baseline enVocab '{word}.{field}' mutated: {orig_rec.get(field)} -> {cur_rec.get(field)}"
                )


def check_server_isolation_support(server_js_text: str | None = None, dry_run: bool | None = None) -> None:
    """Pre-M1 isolation guard: refuse to spawn server.js unless BOKUSEKI_PROGRESS_FILE is wired."""
    text = server_js_text if server_js_text is not None else SERVER_JS_PATH.read_text(encoding="utf-8")
    use_dry_run = is_dry_run() if dry_run is None else dry_run
    if "BOKUSEKI_PROGRESS_FILE" not in text:
        msg = (
            "Pre-M1 guard: server.js does not support BOKUSEKI_PROGRESS_FILE yet; "
            "refusing to spawn server to protect data/user-progress.json."
        )
        if use_dry_run:
            raise unittest.SkipTest(msg)
        raise AssertionError(msg)


def require_en_readings_dataset() -> Path:
    """Return EN_READINGS_PATH, or skip in dry-run / fail in strict mode if not yet created."""
    if not EN_READINGS_PATH.exists():
        msg = f"data/en-readings.json not found at {EN_READINGS_PATH} (M1 pending)."
        if is_dry_run():
            raise unittest.SkipTest(msg)
        raise AssertionError(msg)
    return EN_READINGS_PATH


class IsolatedServer:
    """Spawns an isolated `node server.js` bound to a non-3456 free port and temp progress file."""

    def __init__(
        self,
        create_progress_copy: bool = True,
        custom_progress_data: dict[str, Any] | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> None:
        self.create_progress_copy = create_progress_copy
        self.custom_progress_data = custom_progress_data
        self.extra_env = dict(extra_env) if extra_env else None
        self.snapshot: ProgressSnapshot | None = None
        self.tmp_dir: tempfile.TemporaryDirectory[str] | None = None
        self.tmp_progress_path: Path | None = None
        self.port: int = 0
        self.base_url: str = ""
        self.proc: subprocess.Popen[str] | None = None
        self._stdout_lines: list[str] = []
        self._reader_thread: threading.Thread | None = None

    def start(self) -> "IsolatedServer":
        self.snapshot = capture_progress_snapshot()
        check_server_isolation_support()

        self.tmp_dir = tempfile.TemporaryDirectory(prefix="bokuseki_e2e_")
        self.tmp_progress_path = Path(self.tmp_dir.name) / "user-progress.json"

        if self.custom_progress_data is not None:
            self.tmp_progress_path.write_text(
                json.dumps(self.custom_progress_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        elif self.create_progress_copy:
            shutil.copy2(REAL_PROGRESS_PATH, self.tmp_progress_path)

        self.port = allocate_free_port()
        assert self.port != 3456
        self.base_url = f"http://127.0.0.1:{self.port}"

        env = {
            **os.environ,
            **(self.extra_env or {}),
            "PORT": str(self.port),
            "BOKUSEKI_PROGRESS_FILE": str(self.tmp_progress_path),
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

        def _drain_stdout() -> None:
            assert self.proc is not None and self.proc.stdout is not None
            for line in self.proc.stdout:
                self._stdout_lines.append(line.rstrip("\r\n"))

        self._reader_thread = threading.Thread(target=_drain_stdout, daemon=True)
        self._reader_thread.start()

        deadline = time.monotonic() + 10.0
        ready = False
        last_err: Exception | None = None
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                joined = "\n".join(self._stdout_lines)
                self.stop()
                raise RuntimeError(f"Isolated server exited early ({self.proc.returncode}):\n{joined}")
            try:
                data = self.get_json("/api/progress", timeout=1.0)
                if isinstance(data, dict) and "kanji" in data:
                    ready = True
                    break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                time.sleep(0.1)

        if not ready:
            joined = "\n".join(self._stdout_lines)
            self.stop()
            raise RuntimeError(f"Isolated server failed readiness check: {last_err}\nOutput:\n{joined}")

        # Verify startup stdout reports the temp path inside tmp_dir, never real user-progress.json
        deadline_log = time.monotonic() + 2.0
        logged_path: Path | None = None
        while time.monotonic() < deadline_log:
            for line in list(self._stdout_lines):
                if "Progress saved locally at:" in line:
                    raw_path = line.split("Progress saved locally at:", 1)[1].strip()
                    logged_path = Path(raw_path).resolve()
                    break
            if logged_path is not None:
                break
            time.sleep(0.05)

        if logged_path is None:
            self.stop()
            raise AssertionError(
                f"Server did not log 'Progress saved locally at:'. Output:\n{self._stdout_lines}"
            )
        tmp_root_resolved = Path(self.tmp_dir.name).resolve()
        real_resolved = REAL_PROGRESS_PATH.resolve()
        if logged_path == real_resolved or tmp_root_resolved not in logged_path.parents:
            self.stop()
            raise AssertionError(
                f"Isolation failure! Server logged {logged_path} instead of inside {tmp_root_resolved}"
            )
        return self

    def stop(self) -> None:
        try:
            if self.proc is not None and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait(timeout=5)
            if self._reader_thread is not None:
                self._reader_thread.join(timeout=2)
            if self.proc is not None and self.proc.stdout is not None:
                try:
                    self.proc.stdout.close()
                except OSError:
                    pass
        finally:
            if self.tmp_dir is not None:
                try:
                    self.tmp_dir.cleanup()
                except OSError:
                    pass
                self.tmp_dir = None
            if self.snapshot is not None:
                assert_real_progress_intact(self.snapshot)

    def __enter__(self) -> "IsolatedServer":
        return self.start()

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.stop()

    def request(self, path: str, method: str = "GET", payload: Any = None, timeout: float = 5.0) -> tuple[int, bytes]:
        url = f"{self.base_url}{path}"
        data_bytes = None
        headers = {}
        if payload is not None:
            data_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as err:
            return err.code, err.read()

    def get_json(self, path: str, timeout: float = 5.0) -> Any:
        status, body = self.request(path, method="GET", timeout=timeout)
        if status >= 400:
            raise urllib.error.HTTPError(f"{self.base_url}{path}", status, f"HTTP {status}", {}, None)
        return json.loads(body.decode("utf-8"))

    def get_json_with_status(self, path: str, timeout: float = 5.0) -> tuple[int, Any]:
        status, body = self.request(path, method="GET", timeout=timeout)
        return status, json.loads(body.decode("utf-8"))

    def post_json(self, path: str, payload: Any, timeout: float = 5.0) -> tuple[int, Any]:
        status, body = self.request(path, method="POST", payload=payload, timeout=timeout)
        return status, json.loads(body.decode("utf-8"))

    def read_tmp_progress(self) -> dict[str, Any]:
        assert self.tmp_progress_path is not None
        return json.loads(self.tmp_progress_path.read_text(encoding="utf-8"))


INIT_SPIES_JS = """
(() => {
  window.__xss = undefined;
  window.__speechCalls = [];
  window.__speechCancelCount = 0;
  if (window.speechSynthesis) {
    const proto = Object.getPrototypeOf(window.speechSynthesis);
    const origSpeak = proto.speak;
    const origCancel = proto.cancel;
    proto.speak = function(utt) {
      window.__speechCalls.push({
        text: utt ? String(utt.text || '') : '',
        lang: utt ? String(utt.lang || '') : '',
        rate: utt ? Number(utt.rate) : null,
      });
      try {
        return origSpeak.call(this, utt);
      } catch (_) {
        return undefined;
      }
    };
    proto.cancel = function() {
      window.__speechCancelCount += 1;
      try {
        return origCancel.call(this);
      } catch (_) {
        return undefined;
      }
    };
  }

  window.__mediaCoachCalls = [];
  let _mc;
  Object.defineProperty(window, 'MediaCoach', {
    configurable: true,
    enumerable: true,
    get() { return _mc; },
    set(val) {
      if (val && !val.__spied) {
        const origYG = val.openYouGlish;
        const origMic = val.openMicCoach;
        if (typeof origYG === 'function') {
          val.openYouGlish = function(...args) {
            window.__mediaCoachCalls.push({ fn: 'openYouGlish', args });
            return origYG.apply(this, args);
          };
        }
        if (typeof origMic === 'function') {
          val.openMicCoach = function(...args) {
            window.__mediaCoachCalls.push({ fn: 'openMicCoach', args });
            return origMic.apply(this, args);
          };
        }
        val.__spied = true;
      }
      _mc = val;
    }
  });
})();
"""


class BrowserManager:
    """Manages a single headless Chromium browser instance per test module."""

    def __init__(self) -> None:
        self._pw: Playwright | None = None
        self._browser: Browser | None = None

    def get_browser(self) -> Browser:
        if self._browser is None:
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=True)
        return self._browser

    def close(self) -> None:
        if self._browser is not None:
            try:
                self._browser.close()
            finally:
                self._browser = None
        if self._pw is not None:
            try:
                self._pw.stop()
            finally:
                self._pw = None


class PlaywrightSession:
    """Isolated 1280x860 browser context + page with spies, route blocks, and UI helpers."""

    def __init__(self, browser: Browser, server: IsolatedServer) -> None:
        self.browser = browser
        self.server = server
        self.context: BrowserContext = browser.new_context(viewport=VIEWPORT)
        self.page: Page = self.context.new_page()
        self.page_errors: list[str] = []
        self.dialogs: list[str] = []
        self._closed = False

        self.page.on("pageerror", lambda err: self.page_errors.append(str(err)))

        def _on_dialog(dialog: Any) -> None:
            self.dialogs.append(f"{dialog.type}: {dialog.message}")
            try:
                dialog.dismiss()
            except Exception:  # noqa: BLE001
                pass

        self.page.on("dialog", _on_dialog)
        self.page.route("https://youglish.com/**", lambda route: route.abort())
        self.page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
        self.page.route("https://fonts.gstatic.com/**", lambda route: route.abort())
        self.page.add_init_script(INIT_SPIES_JS)

    def close(self, check_errors: bool = True) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if check_errors:
                self.assert_no_errors()
        finally:
            self.context.close()

    def assert_no_errors(self) -> None:
        if self.page_errors:
            raise AssertionError(f"Uncaught pageerror(s): {self.page_errors}")
        if self.dialogs:
            raise AssertionError(f"Unexpected blocking browser dialog(s): {self.dialogs}")
        xss_val = self.page.evaluate("() => window.__xss")
        if xss_val is not None:
            raise AssertionError(f"XSS payload executed! window.__xss = {xss_val!r}")

    def goto_app(self) -> None:
        self.page.goto(self.server.base_url, wait_until="domcontentloaded")
        self.page.wait_for_function(
            "() => Boolean(window.BokusekiApp && window.EnAtelierApp && document.querySelector('#spaceEnBtn'))",
            timeout=10000,
        )

    def reload_app(self) -> None:
        self.page.reload(wait_until="domcontentloaded")
        self.page.wait_for_function(
            "() => Boolean(window.BokusekiApp && window.EnAtelierApp && document.querySelector('#spaceEnBtn'))",
            timeout=10000,
        )

    def wait_for_progress_save(self, action: Callable[[], None]) -> None:
        """Execute an action and wait for POST /api/progress to finish (handles 350ms debounce)."""
        with self.page.expect_response(
            lambda r: r.url.endswith("/api/progress") and r.request.method == "POST",
            timeout=8000,
        ) as resp_info:
            action()
        resp = resp_info.value
        if resp.status != 200:
            raise AssertionError(f"Expected POST /api/progress 200, got {resp.status}")

    def require_en_reader_m2_m3(self, check_list_populated: bool = True) -> None:
        """Verify M2/M3 EN Reader hooks exist (skips ONLY in dry-run if pending; fails in strict mode)."""
        if self.page.locator("#homeEnterEnReaderBtn").count() == 0 or self.page.locator('[data-enview="enReader"]').count() == 0:
            msg = "M2 EN Reader navigation hooks (#homeEnterEnReaderBtn / data-enview='enReader') missing."
            if is_dry_run():
                raise unittest.SkipTest(msg)
            raise AssertionError(msg)

        if check_list_populated:
            require_en_readings_dataset()
            has_engine = self.page.evaluate(
                "() => Boolean(window.EnAtelierApp && typeof window.EnAtelierApp.ensureReadingsLoaded === 'function')"
            )
            if not has_engine:
                msg = "M3 EnAtelierApp.ensureReadingsLoaded not implemented yet in en-app.js."
                if is_dry_run():
                    raise unittest.SkipTest(msg)
                raise AssertionError(msg)

    def open_en_reader_from_home(self) -> None:
        self.require_en_reader_m2_m3(check_list_populated=True)
        self.page.locator("#homeEnterEnReaderBtn").click()
        expect(self.page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
        expect(self.page.locator("#enReaderList .kanji-item").first).to_be_visible(timeout=8000)

    def open_en_reader_via_tab(self) -> None:
        self.require_en_reader_m2_m3(check_list_populated=True)
        if self.page.locator("#enViewTabs").evaluate("el => el.classList.contains('hidden')"):
            self.page.locator("#spaceEnBtn").click()
        self.page.locator('#enViewTabs .en-view-btn[data-enview="enReader"]').click()
        expect(self.page.locator("#viewEnReader")).not_to_have_class(re.compile(r"\bhidden\b"))
        expect(self.page.locator("#enReaderList .kanji-item").first).to_be_visible(timeout=8000)

    def select_en_level(self, level: str) -> None:
        self.page.locator(f'#enLevelTabs .en-level-btn[data-enlevel="{level}"]').click()

    def open_article_at(self, index: int = 0) -> None:
        items = self.page.locator("#enReaderList .kanji-item")
        expect(items.nth(index)).to_be_visible(timeout=5000)
        items.nth(index).click()
        expect(self.page.locator("#enReaderParagraphs .para-card").first).to_be_visible(timeout=5000)

    def unlock_all_paragraphs(self) -> None:
        cards = self.page.locator("#enReaderParagraphs .para-card")
        total = cards.count()
        for _ in range(total + 2):
            if self.page.locator("#enReaderSummaryBox").is_visible():
                break
            active_btn = self.page.locator("#enReaderParagraphs .para-card.active button").filter(
                has_text=re.compile(r"(Mở đoạn tiếp|Đã hiểu|Mở câu hỏi|câu hỏi)", re.I)
            )
            if active_btn.count() > 0 and active_btn.first.is_visible():
                active_btn.first.click()
            else:
                break
        expect(self.page.locator("#enReaderSummaryBox")).to_be_visible(timeout=5000)

    def click_word_token(self, word_text: str, para_index: int | None = None) -> Locator:
        """Click an exact word token (case-insensitive, punctuation-stripped) in active or specified para."""
        target = word_text.strip().lower()
        if para_index is not None:
            scope = self.page.locator("#enReaderParagraphs .para-card").nth(para_index).locator(".para-en")
        else:
            active = self.page.locator("#enReaderParagraphs .para-card.active .para-en")
            scope = active.first if active.count() > 0 else self.page.locator("#enReaderParagraphs .para-en").first

        tokens = scope.locator(".en-word-token, button, span[data-word]")
        count = tokens.count()
        for idx in range(count):
            tok = tokens.nth(idx)
            raw = (tok.inner_text() or "").strip()
            cleaned = re.sub(r"^[^A-Za-z]+|[^A-Za-z]+$", "", raw).lower()
            data_word = (tok.get_attribute("data-word") or "").strip().lower()
            if cleaned == target or data_word == target or raw.lower() == target:
                tok.click()
                inspector = self.page.locator("#viewEnReader #enInlineInspector")
                expect(inspector).to_be_visible(timeout=5000)
                return inspector
        raise AssertionError(f"Could not find clickable word token '{word_text}' in active paragraph")

    def paste_custom_article(self, title: str, level: str, body: str, wait_save: bool = True) -> None:
        self.page.locator("#openEnCustomReadingBtn").click()
        expect(self.page.locator("#enCustomReadingForm")).not_to_have_class(re.compile(r"\bhidden\b"))
        self.page.locator("#enCustomTitle").fill(title)
        self.page.locator("#enCustomLevel").select_option(level)
        self.page.locator("#enCustomBody").fill(body)
        if wait_save:
            self.wait_for_progress_save(lambda: self.page.locator("#enCustomSaveBtn").click())
        else:
            self.page.locator("#enCustomSaveBtn").click()

    def submit_summary(self, summary_text: str, wait_save: bool = True) -> None:
        expect(self.page.locator("#enReaderSummaryBox")).to_be_visible(timeout=5000)
        self.page.locator("#enReaderSummaryInput").fill(summary_text)
        if wait_save:
            self.wait_for_progress_save(lambda: self.page.locator("#enReaderCompleteBtn").click())
        else:
            self.page.locator("#enReaderCompleteBtn").click()

    def get_speech_calls(self) -> list[dict[str, Any]]:
        return self.page.evaluate("() => window.__speechCalls || []")

    def clear_speech_calls(self) -> None:
        self.page.evaluate("() => { window.__speechCalls = []; }")

    def get_media_coach_calls(self) -> list[dict[str, Any]]:
        return self.page.evaluate("() => window.__mediaCoachCalls || []")
