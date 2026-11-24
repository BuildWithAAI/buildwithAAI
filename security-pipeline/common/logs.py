import logging, sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def setup(verbose: bool = False) -> None:
    (ROOT / "data").mkdir(exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    sh = logging.StreamHandler(sys.stderr); sh.setFormatter(fmt); root.addHandler(sh)
    fh = RotatingFileHandler(ROOT / "data" / "pipeline.log", maxBytes=5_000_000, backupCount=3)
    fh.setFormatter(fmt); root.addHandler(fh)
    for noisy in ("urllib3", "charset_normalizer", "filelock"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
