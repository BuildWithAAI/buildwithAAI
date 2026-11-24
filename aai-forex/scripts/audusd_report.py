from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from aai_fx.research.audusd_report import write_report
if __name__=='__main__':write_report(ROOT)
