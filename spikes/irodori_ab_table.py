"""results.json を表にする。python3 spikes/irodori_ab_table.py [results.json]"""
import json, sys
from pathlib import Path
p = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "tts_out" / "ab" / "results.json"
R = json.loads(p.read_text())
print(f"{'cond':16} {'gen avg/max':>11} {'dur(s)':>16} {'mora/s':>16} {'trail':>5} {'peak':>5} {'rms':>5} {'loud_sd':>7} {'f0sd(st)':>8} {'f0rng':>6} {'voiced':>6} {'pause':>5} {'hnr':>5} {'f0med':>14}")
for k, r in R.items():
    S = r["sents"]
    if "f0_std" not in S[0]: print(k, "(not analyzed)"); continue
    f = lambda key, nd=1: "/".join(f"{s[key]:.{nd}f}" for s in S)
    gens = [s["gen"] for s in S]
    print(f"{k:16} {sum(gens)/3:5.2f}/{max(gens):5.2f} {f('dur'):>16} {f('mora_s'):>16} {max(s['trail'] for s in S):5.2f} {max(s['peak_db'] for s in S):5.1f} {sum(s['rms_db'] for s in S)/3:5.1f} {sum(s['loud_std'] for s in S)/3:7.1f} {sum(s['f0_std'] for s in S)/3:8.2f} {sum(s['f0_rng'] for s in S)/3:6.1f} {sum(s['voiced'] for s in S)/3:6.2f} {sum(s['pauses'] for s in S):5d} {sum(s['hnr'] for s in S)/3:5.1f} {f('f0_med',0):>14}")
