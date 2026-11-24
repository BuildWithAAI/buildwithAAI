"""Compatibility shim (v0 flat module name). Implementation lives in smr.healthcheck; import from there in new code."""
from smr.healthcheck import *  # noqa: F401,F403


if __name__ == "__main__":
    main()
