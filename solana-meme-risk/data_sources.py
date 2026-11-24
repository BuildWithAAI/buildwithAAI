"""Compatibility shim (v0 flat module name). Implementation lives in smr.sources.rpc; import from there in new code."""
from smr.sources.rpc import *  # noqa: F401,F403
from smr.sources.http import *  # noqa: F401,F403
from smr.cache import DiskCache, make_key, CacheMiss  # noqa: F401
