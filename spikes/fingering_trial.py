"""運指プロンプトの試行: メヌエット 1〜8 小節を Claude に運指させ、簡易検証する。"""
import asyncio, json, struct, sys, time
from pathlib import Path
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage

ROOT = Path(__file__).resolve().parents[1]
MID = ROOT / "assets/scores/minuet-g/anna-magdalena-04.mid"
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def parse(path):
    d = path.read_bytes(); ppq = struct.unpack(">H", d[12:14])[0]; i = 14; trks = []
    while i < len(d):
        ln = struct.unpack(">I", d[i+4:i+8])[0]; trks.append(d[i+8:i+8+ln]); i += 8 + ln
    out = []
    for t in trks[1:3]:
        i = 0; tick = 0; st = None; on = {}; notes = []
        def vlq():
            nonlocal i; v = 0
            while True:
                b = t[i]; i += 1; v = (v << 7) | (b & 0x7f)
                if b < 0x80: return v
        while i < len(t):
            tick += vlq(); b = t[i]
            if b == 0xff:
                i += 2; ln = vlq(); i += ln; continue
            if b in (0xf0, 0xf7):
                i += 1; ln = vlq(); i += ln; continue
            if b & 0x80: st = b; i += 1
            hi = st & 0xf0
            if hi in (0xc0, 0xd0): i += 1; continue
            a, v = t[i], t[i+1]; i += 2
            if hi == 0x90 and v > 0: on[a] = tick
            elif hi in (0x80, 0x90) and a in on: notes.append((on.pop(a), tick - 0, a))
        notes = sorted((s, e - s, p) for s, e, p in notes)
        out.append(notes)
    return ppq, out

ppq, (rh, lh) = parse(MID)
bar = ppq * 3
def fmt(notes, tag, maxm):
    lines = {}; ids = []
    for k, (s, dur, p) in enumerate(notes):
        m = s // bar + 1
        if m > maxm: break
        nid = f"{tag[0]}-{k+1:04d}"; ids.append((nid, p, s))
        beat = 1 + (s % bar) / ppq
        lines.setdefault(m, []).append(f"{nid} {NAMES[p%12]}{p//12-1} b{beat:g} dur={dur/ppq:g}")
    return "\n".join(f"[{tag}] m{m}: " + " | ".join(v) for m, v in lines.items()), ids
r_txt, r_ids = fmt(rh, "RIGHT", 8); l_txt, l_ids = fmt(lh, "LEFT", 8)
user = f"key: G major, time: 3/4, tempo: 100\n{r_txt}\n{l_txt}\nfixed: (なし)"
print(user, "\n")

schema = {"type": "object", "required": ["fingering", "events"], "properties": {
    "fingering": {"type": "array", "items": {"type": "object", "required": ["id", "finger"],
        "properties": {"id": {"type": "string"}, "finger": {"type": "integer", "minimum": 1, "maximum": 5}}}},
    "events": {"type": "array", "items": {"type": "object", "required": ["noteId", "type", "measure", "tip"],
        "properties": {"noteId": {"type": "string"}, "type": {"type": "string", "enum": ["thumb_under", "finger_over", "position_shift", "stretch"]},
                       "measure": {"type": "integer"}, "tip": {"type": "string"}}}}}}

async def main():
    opts = ClaudeAgentOptions(system_prompt=(ROOT / "prompts/fingering_system.md").read_text(), model=sys.argv[1] if len(sys.argv) > 1 else "sonnet",
                              tools=[], strict_mcp_config=True, setting_sources=[], max_turns=3,
                              output_format={"type": "json_schema", "schema": schema})
    t = time.perf_counter()
    async with ClaudeSDKClient(options=opts) as c:
        await c.query(user)
        async for m in c.receive_response():
            if isinstance(m, ResultMessage): res = m
    print(f"time={time.perf_counter()-t:.1f}s subtype={res.subtype}")
    out = res.structured_output
    f = {x["id"]: x["finger"] for x in out["fingering"]}
    for tag, ids in (("R", r_ids), ("L", l_ids)):
        seq = " ".join(f"{NAMES[p%12]}{p//12-1}:{f.get(n,'?')}" for n, p, s in ids)
        print(tag, seq)
    missing = [n for n, _, _ in r_ids + l_ids if n not in f]
    print("missing:", missing)
    print("events:", json.dumps(out["events"], ensure_ascii=False, indent=1))
asyncio.run(main())
