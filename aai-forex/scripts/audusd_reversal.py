from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from aai_fx.research.audusd_reversal import run
if __name__=='__main__':run(ROOT)
