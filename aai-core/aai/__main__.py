import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aai_core.hub.cli import main

sys.exit(main())
