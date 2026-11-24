"""`python -m risk ...` -> smr.cli (read-only; never trades, signs or touches keys).
Stable adapter contract: `python -m risk score <MINT> [-v] [--buyers N] [--hops N] [-o out.json]` and
`python -m risk health [--quick] [--mint M]` (see smr/legacy.py and smr/healthcheck.py)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from smr.cli import main  # noqa: E402

if __name__ == "__main__":
    main()
