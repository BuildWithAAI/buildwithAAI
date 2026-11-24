import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def pytest_configure(config):
    config.addinivalue_line("markers", "network: needs live network access (excluded from `health` quick tests)")

# The edge features (smr/paper/edge.py) are switched on in data/paper_edge.json for the live routine; tests that do
# not pass an explicit edge_cfg must see the pre-edge behaviour.
os.environ.setdefault("SMR_PAPER_EDGE_CONFIG", "off")
