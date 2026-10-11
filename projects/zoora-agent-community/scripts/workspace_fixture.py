"""Empty private state for real browser authoring tests. No product sample records."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from zoora_community.server import serve  # noqa: E402
from zoora_community.store import Store  # noqa: E402

folder = Path(sys.argv[1])
Store.initialize(folder / "state", folder / "owner.credential.json")
serve(folder / "state", 0)
