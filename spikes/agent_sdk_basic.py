"""M0 spike: ClaudeSDKClient の文脈保持・レイテンシ・構造化出力・resume・画像入力を確認する。"""
import asyncio, base64, json, struct, sys, time, zlib

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient,
                              RateLimitEvent, ResultMessage, StreamEvent, TextBlock)

SYSTEM = """あなたはピアノの先生です。必ず次の形式だけで返答してください。
<say>学習者への話し言葉(1〜2文)</say>
<action>{"type": "...", ...}</action>"""

def opts(**kw):
    base = dict(tools=[], setting_sources=[], system_prompt=SYSTEM, model="sonnet",
                include_partial_messages=True, max_turns=1)
    base.update(kw)
    return ClaudeAgentOptions(**base)

async def turn(client, prompt, label):
    t0 = time.perf_counter(); first = None; text = ""; result = None
    await client.query(prompt)
    async for m in client.receive_response():
        if isinstance(m, StreamEvent):
            ev = m.event
            if ev.get("type") == "content_block_delta" and ev["delta"].get("type") == "text_delta":
                if first is None: first = time.perf_counter() - t0
        elif isinstance(m, AssistantMessage):
            text += "".join(b.text for b in m.content if isinstance(b, TextBlock))
        elif isinstance(m, RateLimitEvent):
            print(f"  [rate-limit] {m.rate_limit_info.status} {m.rate_limit_info.rate_limit_type} util={m.rate_limit_info.utilization}")
        elif isinstance(m, ResultMessage):
            result = m
    total = time.perf_counter() - t0
    print(f"[{label}] first_delta={first and round(first,2)}s total={total:.2f}s "
          f"api={result.duration_api_ms}ms cost_usd={result.total_cost_usd} session={result.session_id[:8]}")
    print("  text:", text.replace("\n", " ")[:300])
    if result.structured_output is not None:
        print("  structured:", json.dumps(result.structured_output, ensure_ascii=False)[:300])
    return result

def tiny_png(rgb=(220, 30, 30), size=32):
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

async def main():
    # 1) 長寿命セッションで 3 往復: 文脈保持とレイテンシ
    t = time.perf_counter()
    async with ClaudeSDKClient(options=opts()) as c:
        print(f"[connect] {time.perf_counter()-t:.2f}s")
        await turn(c, "[HEARING_ANSWER] 名前はタロウ。ピアノは完全な初心者で、サビだけ弾きたい。", "t1")
        await turn(c, '[ATTEMPT_RESULT] {"pitchAccuracy":0.72,"timingStdMs":110,"weakSpots":[{"measure":3}]}', "t2")
        r = await turn(c, "[USER_MESSAGE] 私の名前とレベル、さっき苦手だった小節を覚えてる？", "t3")
        sid = r.session_id

    # 2) resume: 別プロセスから同じセッションを再開
    t = time.perf_counter()
    async with ClaudeSDKClient(options=opts(resume=sid)) as c:
        print(f"[resume-connect] {time.perf_counter()-t:.2f}s")
        await turn(c, "[RESUME] 前回の続きです。私の名前と苦手な小節は？", "resume")

    # 3) 構造化出力 (output_format)
    schema = {"type": "object", "required": ["say", "action"], "properties": {
        "say": {"type": "string"},
        "action": {"type": "object", "required": ["type"], "properties": {
            "type": {"type": "string", "enum": ["retry", "next", "demo"]},
            "tempoPercent": {"type": "integer"}}}}}
    async with ClaudeSDKClient(options=opts(system_prompt="あなたはピアノの先生です。", max_turns=3,
                                            output_format={"type": "json_schema", "schema": schema})) as c:
        await turn(c, '[ATTEMPT_RESULT] {"pitchAccuracy":0.6,"timingStdMs":150} 次の行動を決めて', "structured")

    # 4) 画像を content block で直接渡す（ツール不要か）
    png = base64.b64encode(tiny_png()).decode()
    async def msgs():
        yield {"type": "user", "message": {"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": png}},
            {"type": "text", "text": "この画像は何色？<say>で一言だけ答えて。"}]}, "parent_tool_use_id": None}
    async with ClaudeSDKClient(options=opts()) as c:
        await turn(c, msgs(), "image")

asyncio.run(main())
