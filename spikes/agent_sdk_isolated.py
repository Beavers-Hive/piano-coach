import asyncio, sys, time
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, SystemMessage, StreamEvent
SYSTEM = "あなたはピアノの先生です。<say>…</say><action>{json}</action> の形式で返答。"
async def run(label, env, **kw):
    o = dict(tools=[], setting_sources=[], system_prompt=SYSTEM, model="sonnet", max_turns=1,
             include_partial_messages=True, env=env); o.update(kw)
    async with ClaudeSDKClient(options=ClaudeAgentOptions(**o)) as c:
        for i, p in enumerate(["名前はタロウ、初心者です", '[ATTEMPT_RESULT] {"pitchAccuracy":0.72,"weak":3}', "名前と苦手小節は？"]):
            t = time.perf_counter(); first=None; await c.query(p)
            async for m in c.receive_response():
                if isinstance(m, SystemMessage) and m.subtype == "init":
                    print(label, "tools:", len(m.data.get("tools") or []))
                if isinstance(m, StreamEvent) and first is None and m.event.get("type")=="content_block_delta": first=time.perf_counter()-t
                if isinstance(m, ResultMessage):
                    u = m.usage or {}
                    print(f"{label} t{i+1} first={first and round(first,2)}s total={time.perf_counter()-t:.2f}s ctx={u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0)+u.get('input_tokens',0)} -> {(m.result or '')[:70]!r}")
asyncio.run(run("strict", {}, strict_mcp_config=True))
asyncio.run(run("strict+env", {"ENABLE_CLAUDEAI_MCP_SERVERS": "false"}, strict_mcp_config=True))
