"""Run root research tests without the separately supported scanner runtime.

The scanner is tested on Linux with Python 3.11/3.12 in scanner-tests.yml.
The research foundation also supports Windows and Python 3.14. Its scanner
feed contract tests remain research tests and must run on both platforms.
The complete root suite is still run by python-tests.yml and scanner-tests.yml.
"""

from pathlib import Path
import sys
import unittest


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    tests = root / "tests"
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for path in sorted(tests.glob("test_*.py")):
        scanner_runtime = path.stem == "test_aai_scanner" or (
            path.stem.startswith("test_scanner_") and path.stem != "test_scanner_feed"
        )
        if not scanner_runtime:
            suite.addTests(loader.discover(str(tests), pattern=path.name))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
