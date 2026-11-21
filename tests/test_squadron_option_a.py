"""Isolated Playwright E2E verification for Squadron Option A (Whole-Word Active Recall)."""

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
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page, expect, sync_playwright

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
SERVER_JS_PATH = ROOT_DIR / "server.js"
REAL_PROGRESS_PATH = DATA_DIR / "user-progress.json"

INIT_SPIES_JS = """
(() => {
  window.__xss = undefined;
  window.__speechCalls = [];
  if (window.speechSynthesis) {
    const proto = Object.getPrototypeOf(window.speechSynthesis);
    const origSpeak = proto.speak;
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
  }
})();
"""


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
    """Spawns server.js on an ephemeral port using a temp progress file and verifies real file untouched."""

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
        self.tmp_dir = tempfile.TemporaryDirectory(prefix="bokuseki_sq_a_")
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
        raise RuntimeError(f"Isolated server failed to start:\n" + "\n".join(self._stdout))

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


def _make_base_progress(en_vocab: dict[str, Any], global_10k: bool = False) -> dict[str, Any]:
    return {
        "version": 1,
        "createdAt": "2026-11-17T00:00:00.000Z",
        "updatedAt": "2026-11-17T00:00:00.000Z",
        "settings": {
            "theme": "washi",
            "level": 5,
            "dailyNewLimit": 10,
            "enLevel": "A1",
            "enDailyNewLimit": 10,
            "enGlobal10k": global_10k,
        },
        "stats": {"totalFocusSeconds": 1200},
        "kanji": {},
        "enVocab": en_vocab,
        "readingsDone": {},
        "customReadings": [],
        "enReadingsDone": {},
        "enReadingNotes": {},
        "enCustomReadings": [],
        "sentencesDone": {},
        "examNotes": {},
        "sessionLogs": [],
    }


def _open_squadron(page: Page, base_url: str) -> None:
    page.goto(base_url, wait_until="domcontentloaded")
    page.wait_for_function("() => Boolean(window.BokusekiApp && window.EnAtelierApp)", timeout=10000)
    page.locator("#spaceEnBtn").click()
    page.locator('#enViewTabs .en-view-btn[data-enview="enSquadron"]').click()
    expect(page.locator("#enModeSquadron")).not_to_have_class(re.compile(r"\bhidden\b"))


def _get_sq(page: Page) -> dict[str, Any]:
    return page.evaluate("() => window.EnAtelierApp.getSquadronDebugState()")


def _get_speech(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__speechCalls || []")


def _clear_speech(page: Page) -> None:
    page.evaluate("() => { window.__speechCalls = []; }")


def _type_and_fire(page: Page, word: str) -> None:
    inp = page.locator("#sqTypeInput")
    inp.fill(word)
    inp.press("Enter")


class TestSquadronOptionA(unittest.TestCase):
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

    def _new_page(self) -> tuple[BrowserContext, Page, list[str], list[str]]:
        assert self._browser is not None
        ctx = self._browser.new_context(viewport={"width": 1280, "height": 860})
        page = ctx.new_page()
        errors: list[str] = []
        dialogs: list[str] = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.route("https://youglish.com/**", lambda r: r.abort())
        page.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        page.route("https://fonts.gstatic.com/**", lambda r: r.abort())
        page.add_init_script(INIT_SPIES_JS)
        return ctx, page, errors, dialogs

    def test_01_default_blind_mode_zero_latin_leaks_and_form_press_video(self) -> None:
        due_past = "2026-11-18T10:00:00.000Z"
        en_vocab = {
            "form": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "press": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "video": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "respect": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "report": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
        }
        prog = _make_base_progress(en_vocab, global_10k=True)
        with CustomIsolatedServer(prog) as srv:
            ctx, page, errors, dialogs = self._new_page()
            try:
                _open_squadron(page, srv.base_url)
                self.assertEqual(page.locator("#sqRecallSelect").input_value(), "blind_meaning")
                expect(page.locator("#sqFireBtn")).to_be_visible()
                expect(page.locator("#sqReplayAudioBtn")).to_be_visible()

                page.locator("#sqHeroLaunchBtn").click()
                page.wait_for_timeout(150)

                st = _get_sq(page)
                self.assertTrue(st["running"])
                self.assertEqual(st["wave"], 1)
                self.assertEqual(len(st["enemies"]), 3)
                self.assertFalse(st["usingFallbackDeck"])

                # Verify zero Latin leaks in clueText / targetText even for 100% root-matching form/press/video
                for enemy in st["enemies"]:
                    ans = enemy["answerWord"].lower()
                    root_id = (enemy["rootId"] or "").lower()
                    clue_l = enemy["clueText"].lower()
                    targ_l = enemy["targetText"].lower()
                    self.assertNotIn(ans, clue_l, f"Answer '{ans}' leaked in clueText: {clue_l}")
                    self.assertNotIn(ans, targ_l, f"Answer '{ans}' leaked in targetText: {targ_l}")
                    if root_id:
                        self.assertNotIn(f"[{root_id}]", clue_l, f"Latin rootId leaked: {clue_l}")
                    self.assertNotRegex(targ_l, r"[a-z]", f"Single-word targetText must hide all Latin chars: {targ_l}")

                # Verify vertical/horizontal separation (no overlapping rectangles)
                rects = [e["rect"] for e in st["enemies"] if e.get("rect")]
                self.assertEqual(len(rects), 3)
                for i in range(len(rects)):
                    for j in range(i + 1, len(rects)):
                        a, b = rects[i], rects[j]
                        x_overlap = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
                        y_overlap = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
                        self.assertFalse(
                            x_overlap > 0 and y_overlap > 0,
                            f"Enemy cards overlap at wave 1: {a} vs {b}",
                        )
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])

    def test_02_whole_word_fire_near_miss_typo_and_backspace_recovery(self) -> None:
        due_past = "2026-11-18T10:00:00.000Z"
        en_vocab = {
            "respect": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "message": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "special": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
        }
        with CustomIsolatedServer(_make_base_progress(en_vocab)) as srv:
            ctx, page, errors, dialogs = self._new_page()
            try:
                _open_squadron(page, srv.base_url)
                page.locator("#sqHeroLaunchBtn").click()
                page.wait_for_timeout(120)

                st0 = _get_sq(page)
                target_word = st0["enemies"][0]["answerWord"]

                # Typing 1st letter does NOT auto-lock or destroy
                page.locator("#sqTypeInput").click()
                page.keyboard.type(target_word[0])
                st_partial = _get_sq(page)
                self.assertEqual(len(st_partial["enemies"]), 3)
                self.assertEqual(st_partial["hits"], 0)
                self.assertEqual(page.locator("#sqTypeInput").input_value(), target_word[0])

                # Near-miss typo + Enter warns WITHOUT spoiling target_word and keeps text for Backspace edit
                typo = target_word[:-2] + target_word[-1]  # 1-char deletion (e.g. respec + t? -> respet)
                _type_and_fire(page, typo)
                st_miss = _get_sq(page)
                self.assertEqual(st_miss["misses"], 1)
                self.assertEqual(len(st_miss["enemies"]), 3)
                lock_txt = page.locator("#sqLockStatus").inner_text()
                self.assertIn("Gần đúng chính tả", lock_txt)
                self.assertNotIn(target_word.lower(), lock_txt.lower())
                self.assertEqual(page.locator("#sqTypeInput").input_value(), typo)

                # Fix via Backspace/fill + Enter fires projectile, kills target, calls speakEnglish
                _clear_speech(page)
                _type_and_fire(page, target_word)
                st_hit = _get_sq(page)
                self.assertEqual(st_hit["hits"], 1)
                self.assertEqual(len(st_hit["enemies"]), 2)
                self.assertGreater(st_hit["score"], 0)
                self.assertEqual(st_hit["empCharge"], 20)
                speech = _get_speech(page)
                self.assertTrue(any(c["text"].lower() == target_word.lower() for c in speech))
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])

    def test_03_morph_forge_mode_and_two_tier_radar(self) -> None:
        due_past = "2026-11-18T10:00:00.000Z"
        en_vocab = {
            "respect": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "report": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "predict": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
        }
        with CustomIsolatedServer(_make_base_progress(en_vocab)) as srv:
            ctx, page, errors, dialogs = self._new_page()
            try:
                _open_squadron(page, srv.base_url)
                page.locator("#sqRecallSelect").select_option("morph_forge")
                page.locator("#sqHeroLaunchBtn").click()
                page.wait_for_timeout(120)

                st0 = _get_sq(page)
                for e in st0["enemies"]:
                    self.assertIn("🧬", e["clueText"])
                    self.assertNotIn(e["answerWord"].lower(), e["clueText"].lower())
                    self.assertNotIn(e["rootId"].lower(), e["clueText"].lower())

                # Radar Tier 1 (Tab): speaks audio & reveals IPA + Vietnamese morph, STILL no Latin answer
                _clear_speech(page)
                page.locator("#sqTypeInput").press("Tab")
                st1 = _get_sq(page)
                focused = next(e for e in st1["enemies"] if e["id"] == st1["focusedId"])
                self.assertEqual(focused["radarLevel"], 1)
                self.assertTrue(focused["usedRadar"])
                self.assertNotIn(focused["answerWord"].lower(), focused["targetText"].lower())
                self.assertIn("/", focused["targetText"])  # IPA shown
                self.assertIn(focused["answerWord"].lower(), st1["missedWords"])
                self.assertTrue(any(c["text"].lower() == focused["answerWord"].lower() for c in _get_speech(page)))

                # Radar Tier 2 (Tab again): NOW reveals answer so user can type and clear, stays in missedWords
                page.locator("#sqTypeInput").press("Tab")
                st2 = _get_sq(page)
                focused2 = next(e for e in st2["enemies"] if e["id"] == st2["focusedId"])
                self.assertEqual(focused2["radarLevel"], 2)
                self.assertIn(focused2["answerWord"].lower(), focused2["targetText"].lower())

                ans = focused2["answerWord"]
                _type_and_fire(page, ans)
                st3 = _get_sq(page)
                self.assertIn(ans.lower(), st3["missedWords"])
                self.assertNotIn(ans.lower(), st3["cleanKills"])
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])

    def test_04_audio_radar_hides_meaning_and_speaks_full_collocation_and_sentence(self) -> None:
        due_past = "2026-11-18T10:00:00.000Z"
        en_vocab = {
            "message": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "report": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "support": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
        }
        with CustomIsolatedServer(_make_base_progress(en_vocab)) as srv:
            ctx, page, errors, dialogs = self._new_page()
            try:
                _open_squadron(page, srv.base_url)
                page.locator("#sqDeckSelect").select_option("collocations")
                page.locator("#sqRecallSelect").select_option("audio_radar")
                _clear_speech(page)
                page.locator("#sqHeroLaunchBtn").click()
                page.wait_for_timeout(120)

                st = _get_sq(page)
                self.assertEqual(len(st["enemies"]), 2)
                for e in st["enemies"]:
                    # Must hide Vietnamese meaning in audio_radar Tier 0
                    self.assertIn("🔊 Nghe & gõ đáp án", e["clueText"])
                    # Collocation Cloze masks the word AND audioText holds full phrase (not just 1 word)
                    self.assertIn("_______", e["targetText"])
                    self.assertGreaterEqual(len(e["audioText"].split()), 2)
                    self.assertNotIn(e["answerWord"].lower(), e["targetText"].lower())

                # Verify speech synthesis spoke FULL multi-word phrase!
                calls = _get_speech(page)
                self.assertTrue(calls)
                self.assertGreaterEqual(len(calls[0]["text"].split()), 2)
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])

    def test_05_full_5_waves_elite_cloze_and_wave5_boss_3_armor_layers_no_48_char_cut(self) -> None:
        due_past = "2026-11-18T10:00:00.000Z"
        en_vocab = {
            "message": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "different": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "special": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "respect": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "report": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "program": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
        }
        with CustomIsolatedServer(_make_base_progress(en_vocab)) as srv:
            ctx, page, errors, dialogs = self._new_page()
            try:
                _open_squadron(page, srv.base_url)
                page.locator("#sqSpeedSelect").select_option("calm")
                page.locator("#sqHeroLaunchBtn").click()
                page.wait_for_timeout(120)

                saw_elite_cloze = False
                saw_boss_3_layers = False
                max_sentence_len_seen = 0

                for _step in range(40):
                    st = _get_sq(page)
                    if st["finished"]:
                        break
                    if not st["enemies"]:
                        page.wait_for_timeout(1400)
                        continue
                    for e in st["enemies"]:
                        if e["isElite"]:
                            saw_elite_cloze = True
                            self.assertTrue(e["isCloze"])
                            self.assertIn("_______", e["targetText"])
                            self.assertNotIn(e["answerWord"].lower(), e["targetText"].lower())
                        if e["isBoss"]:
                            saw_boss_3_layers = True
                            self.assertEqual(e["armorCount"], 3)
                            for layer in e["armorStages"]:
                                self.assertIn("_______", layer["displayCloze"])
                                self.assertNotIn(layer["answerWord"].lower(), layer["displayCloze"].lower())
                                max_sentence_len_seen = max(max_sentence_len_seen, len(layer["fullText"]))
                    target = st["enemies"][0]
                    _clear_speech(page)
                    _type_and_fire(page, target["answerWord"])
                    if target["isBoss"] and target["armorIdx"] < target["armorCount"] - 1:
                        st_after_layer = _get_sq(page)
                        still_boss = next((x for x in st_after_layer["enemies"] if x["id"] == target["id"]), None)
                        self.assertIsNotNone(still_boss)
                        assert still_boss is not None
                        self.assertEqual(still_boss["armorIdx"], target["armorIdx"] + 1)
                        # Confirm Boss layer spoken sentence matches FULL unbroken sentence (never reduced to 1 single word!)
                        calls = _get_speech(page)
                        self.assertTrue(
                            any(c["text"] == target["audioText"] and len(c["text"].split()) >= 5 for c in calls),
                            f"Boss speech did not speak full sentence '{target['audioText']}': {calls}",
                        )

                st_end = _get_sq(page)
                self.assertTrue(st_end["finished"], "Campaign should finish cleanly after Boss 3rd armor layer breaks")
                self.assertTrue(saw_elite_cloze)
                self.assertTrue(saw_boss_3_layers)
                self.assertGreater(max_sentence_len_seen, 52, "Wave 5 Boss sentences must NOT be truncated at 48 chars")
                expect(page.locator("#sqSummaryOverlay")).to_be_visible()
                self.assertEqual(len(st_end["cleanKills"]), 6)
                self.assertEqual(len(st_end["missedWords"]), 0)
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])

    def test_06_pushback_freeze_skill_never_kills_for_free(self) -> None:
        due_past = "2026-11-18T10:00:00.000Z"
        en_vocab = {
            "message": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "form": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "press": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "visit": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "reply": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "value": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "offer": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
        }
        with CustomIsolatedServer(_make_base_progress(en_vocab)) as srv:
            ctx, page, errors, dialogs = self._new_page()
            try:
                _open_squadron(page, srv.base_url)
                page.locator("#sqHeroLaunchBtn").click()
                page.wait_for_timeout(120)

                # Clear wave 1 (3 hits -> 60% charge), then clear 2 ships on wave 2 (-> 100% charge)
                for _ in range(3):
                    st = _get_sq(page)
                    _type_and_fire(page, st["enemies"][0]["answerWord"])
                page.wait_for_timeout(1400)
                for _ in range(2):
                    st = _get_sq(page)
                    _type_and_fire(page, st["enemies"][0]["answerWord"])

                st_ready = _get_sq(page)
                self.assertEqual(st_ready["empCharge"], 100)
                expect(page.locator("#sqEmpBtn")).to_be_enabled()
                before_kills = len(st_ready["cleanKills"])
                before_count = len(st_ready["enemies"])
                before_ys = {e["id"]: e["y"] for e in st_ready["enemies"]}

                page.locator("#sqEmpBtn").click()
                st_after = _get_sq(page)
                self.assertEqual(st_after["empCharge"], 0)
                self.assertEqual(len(st_after["enemies"]), before_count, "Pushback must NOT auto-kill enemies")
                self.assertEqual(len(st_after["cleanKills"]), before_kills, "Pushback must NOT grant free cleanKills")
                for e in st_after["enemies"]:
                    self.assertLessEqual(e["y"], before_ys[e["id"]])
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])

    def test_07_learned_deck_isolation_speed_visible_lock_srs_sm2_sync_and_chip_jump(self) -> None:
        due_past = "2026-11-18T10:00:00.000Z"
        en_vocab = {
            "message": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "video": {"reps": 1, "interval": 1, "ease": 2.5, "writePasses": 0, "blindPasses": 0, "note": "", "due": due_past},
            "report": {"reps": 2, "interval": 4, "ease": 2.5, "writePasses": 0, "blindPasses": 1, "note": "", "due": "2026-12-30T00:00:00.000Z"},
        }
        with CustomIsolatedServer(_make_base_progress(en_vocab, global_10k=True)) as srv:
            ctx, page, errors, dialogs = self._new_page()
            try:
                _open_squadron(page, srv.base_url)

                # First verify speed_visible locks SRS button cleanly
                page.locator("#sqRecallSelect").select_option("speed_visible")
                page.locator("#sqHeroLaunchBtn").click()
                page.wait_for_timeout(120)
                st_vis = _get_sq(page)
                self.assertEqual(set(st_vis["deckPoolKeys"]), {"message", "video", "report"})
                self.assertFalse(st_vis["sessionRecallEligible"])
                self.assertNotIn("B2", st_vis["deckPhraseLvls"])
                self.assertNotIn("B2", st_vis["deckSentLvls"])

                # Switch to blind_meaning and restart clean campaign
                page.locator("#sqRecallSelect").select_option("blind_meaning")
                page.locator("#sqStartBtn").click()
                page.wait_for_timeout(120)

                st0 = _get_sq(page)
                self.assertTrue(st0["sessionRecallEligible"])
                self.assertEqual(set(st0["deckPoolKeys"]), {"message", "video", "report"})

                # Mark 'video' via Radar Tier 1+2, shoot the rest cleanly across waves
                for _ in range(30):
                    st = _get_sq(page)
                    if st["finished"]:
                        break
                    if not st["enemies"]:
                        page.wait_for_timeout(1400)
                        continue
                    target = st["enemies"][0]
                    if target["answerWord"] == "video" and not target["usedRadar"]:
                        # Click enemy on canvas then press Tab twice for Radar 2
                        r = target["rect"]
                        box = page.locator("#sqCanvas").bounding_box()
                        assert box is not None and r is not None
                        cx = box["x"] + ((r["x"] + r["w"] / 2) / 920.0) * box["width"]
                        cy = box["y"] + ((r["y"] + r["h"] / 2) / 480.0) * box["height"]
                        page.mouse.click(cx, cy)
                        page.locator("#sqTypeInput").press("Tab")
                        page.locator("#sqTypeInput").press("Tab")
                    _type_and_fire(page, target["answerWord"])

                expect(page.locator("#sqSummaryOverlay")).to_be_visible()
                expect(page.locator("#sqSyncSrsBtn")).to_be_enabled()
                clean_txt = page.locator("#sqCleanList").inner_text().lower()
                review_txt = page.locator("#sqReviewList").inner_text().lower()
                self.assertIn("video", review_txt)
                self.assertNotIn("video", clean_txt)
                self.assertIn("message", clean_txt)

                # Sync to SRS and verify SM-2 advancement on 'message' + persistent due on 'video' + 0 new cards
                with page.expect_response(lambda r: r.url.endswith("/api/progress") and r.request.method == "POST", timeout=8000):
                    page.locator("#sqSyncSrsBtn").click()

                saved = srv.get_progress()
                self.assertEqual(set(saved["enVocab"].keys()), {"message", "video", "report"})
                self.assertEqual(saved["enVocab"]["message"]["blindPasses"], 1)
                self.assertGreater(saved["enVocab"]["message"]["reps"], 1)
                self.assertGreater(saved["enVocab"]["message"]["due"], "2026-11-20T00:00:00.000Z")
                self.assertLessEqual(saved["enVocab"]["video"]["due"], saved["updatedAt"])

                # Clicking chip in #sqReviewList jumps directly to 1. Xưởng Gốc Từ on 'video'
                page.locator("#sqReviewList .sq-word-chip").first.click()
                expect(page.locator("#enModeSquadron")).to_have_class(re.compile(r"\bhidden\b"))
                expect(page.locator("#enPromptWord")).to_contain_text("video", ignore_case=True)
            finally:
                ctx.close()
                self.assertEqual(errors, [])
                self.assertEqual(dialogs, [])


if __name__ == "__main__":
    unittest.main()
