"""CLI runner for the isolated 3. Đọc sâu E2E test suite.

Usage:
    python tests/run_e2e.py [--dry-run] [--tier 1|2|3|4|security|all]
"""

from __future__ import annotations

import argparse
import os
import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from tests.harness import assert_real_progress_intact, capture_progress_snapshot  # noqa: E402

TIER_PATTERNS = {
    "1": ["test_harness_isolation.py", "test_tier1_dataset.py", "test_tier1_features.py"],
    "2": ["test_harness_isolation.py", "test_tier1_dataset.py", "test_tier2_boundaries.py"],
    "3": ["test_harness_isolation.py", "test_tier3_cross_feature.py"],
    "4": ["test_harness_isolation.py", "test_tier4_scenarios.py"],
    "security": ["test_harness_isolation.py", "test_security_r3.py"],
    "all": ["test_*.py"],
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run 3. Đọc sâu isolated E2E tests.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Set BOKUSEKI_E2E_STRICT=0 so pending M1/M2/M3 features skip cleanly without failing.",
    )
    parser.add_argument(
        "--tier",
        choices=("1", "2", "3", "4", "security", "all"),
        default="all",
        help="Which tier(s) to run (default: all).",
    )
    parser.add_argument("-v", "--verbosity", type=int, default=2, help="unittest verbosity (default: 2).")
    args = parser.parse_args(argv)

    if args.dry_run:
        os.environ["BOKUSEKI_E2E_STRICT"] = "0"
    else:
        os.environ.setdefault("BOKUSEKI_E2E_STRICT", "1")

    snapshot = capture_progress_snapshot()

    loader = unittest.TestLoader()
    tests_dir = Path(__file__).resolve().parent
    suite = unittest.TestSuite()
    for pattern in TIER_PATTERNS[args.tier]:
        discovered = loader.discover(start_dir=str(tests_dir), pattern=pattern, top_level_dir=str(ROOT_DIR))
        suite.addTests(discovered)

    runner = unittest.TextTestRunner(verbosity=args.verbosity)
    result = runner.run(suite)

    assert_real_progress_intact(snapshot)
    print(
        f"\n[INTEGRITY OK] Real data/user-progress.json SHA-256={snapshot.sha256} "
        f"(kanji={len(snapshot.data['kanji'])}, enVocab={len(snapshot.data['enVocab'])}) unchanged."
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
