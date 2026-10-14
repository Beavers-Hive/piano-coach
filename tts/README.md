# tts

Irodori-TTS（`Aratako/Irodori-TTS-v4.1-Small-MF`、MPS、fp32）を常駐させる HTTP サーバー。127.0.0.1:8790。

```
cd vendor/Irodori-TTS && HF_HUB_DISABLE_IMPLICIT_TOKEN=1 uv run --no-sync python ../../tts/server.py
```

- 起動時にモデルを 1 回だけ読み込み、ウォームアップ合成を 1 回行う（読み込み約 12〜25 秒）。`/health` が `ok: true` を返したら準備完了。
- `POST /synthesize` `{"text": "...", "seed": 1234}` -> `audio/wav`。caption は固定（明るく優しい 20 代女性のピアノの先生）、参照音声なし。
  読み補正（弾く -> ひく など）は呼び出し側 `apps/server/piano_coach/voice/` で済ませる。
- `GET /health` -> `{"ok": true, "model": "..."}`
- 合成は asyncio.Lock で直列化している（MPS で同時に推論しない）。
- 環境変数: `TTS_PORT`、`TTS_MODEL`、`TTS_DEVICE`、`TTS_CODEC_DEVICE`、`TTS_PRECISION`。
