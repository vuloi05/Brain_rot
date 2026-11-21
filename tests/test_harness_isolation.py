"""Built-in self-tests for E2E test harness isolation, port safety, and snapshot guards."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from tests.harness import (
    EXPECTED_BASELINE_KEYS,
    EXPECTED_EN_VOCAB_COUNT,
    EXPECTED_KANJI_COUNT,
    IsolatedServer,
    allocate_free_port,
    assert_real_progress_intact,
    capture_progress_snapshot,
    check_server_isolation_support,
)


class TestHarnessIsolation(unittest.TestCase):
    """Verify isolation invariants before any E2E mutation can happen."""

    def test_allocate_free_port_never_returns_3456(self) -> None:
        ports = [allocate_free_port() for _ in range(10)]
        self.assertTrue(all(isinstance(p, int) and p > 0 and p != 3456 for p in ports))

    def test_progress_snapshot_baseline_invariants(self) -> None:
        snap = capture_progress_snapshot()
        self.assertEqual(len(snap.sha256), 64)
        self.assertTrue(EXPECTED_BASELINE_KEYS.issubset(snap.data.keys()))
        self.assertEqual(len(snap.data["kanji"]), EXPECTED_KANJI_COUNT)
        self.assertEqual(len(snap.data["enVocab"]), EXPECTED_EN_VOCAB_COUNT)
        assert_real_progress_intact(snap)

    def test_pre_m1_guard_strict_vs_dry_run_without_spawning(self) -> None:
        fake_legacy_server_js = "const PROGRESS_FILE = path.join(DATA_DIR, 'user-progress.json');"
        with self.assertRaises(AssertionError):
            check_server_isolation_support(server_js_text=fake_legacy_server_js, dry_run=False)
        with self.assertRaises(unittest.SkipTest):
            check_server_isolation_support(server_js_text=fake_legacy_server_js, dry_run=True)

    def test_isolated_server_writes_to_temp_copy_and_leaves_real_intact(self) -> None:
        snap = capture_progress_snapshot()
        tmp_dir_path: Path | None = None

        with IsolatedServer() as srv:
            self.assertNotEqual(srv.port, 3456)
            assert srv.tmp_progress_path is not None
            assert srv.tmp_dir is not None
            tmp_dir_path = Path(srv.tmp_dir.name)
            self.assertTrue(srv.tmp_progress_path.exists())

            prog = srv.get_json("/api/progress")
            self.assertEqual(len(prog["kanji"]), EXPECTED_KANJI_COUNT)
            self.assertEqual(len(prog["enVocab"]), EXPECTED_EN_VOCAB_COUNT)

            # Mutate isolated progress ONLY
            prog.setdefault("enReadingsDone", {})["__harness_probe__"] = {
                "completedAt": "2026-11-19T00:00:00.000Z",
                "summary": "Isolated probe write",
            }
            status, body = srv.post_json("/api/progress", prog)
            self.assertEqual(status, 200)
            self.assertTrue(body.get("ok"))

            persisted = json.loads(srv.tmp_progress_path.read_text(encoding="utf-8"))
            self.assertIn("__harness_probe__", persisted.get("enReadingsDone", {}))

            # Real file remains untouched even mid-run
            assert_real_progress_intact(snap)

        # Temp directory cleaned up after stop() and real file intact
        assert tmp_dir_path is not None
        self.assertFalse(tmp_dir_path.exists())
        assert_real_progress_intact(snap)


if __name__ == "__main__":
    unittest.main()
