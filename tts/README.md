# tts

Irodori-TTS（`Aratako/Irodori-TTS-v4.1-Small-MF`、MPS、fp32）を常駐させる HTTP サーバー。127.0.0.1:8790。

```
cd vendor/Irodori-TTS && HF_HUB_DISABLE_IMPLICIT_TOKEN=1 uv run --no-sync python ../../tts/server.py
```

- 起動時にモデルを 1 回だけ読み込み、ウォームアップ合成を 1 回行う（読み込み約 12〜25 秒）。`/health` が `ok: true` を返したら準備完了。
- `POST /synthesize` `{"text": "...", "seed": 1234}` -> `audio/wav`。caption は固定（明るく優しい 20 代女性のピアノの先生）。
  声は `tts/voice/teacher_ref.pt`（参照音声の latent。このモデル自身が生成した声から作った）で固定し、話す速さは `duration_scale=0.9`。
  2026-10-15 の A/B の結果で、理由と比較表は `spikes/tts_out/ab/README.md`。
  読み補正（弾く -> ひく など）は呼び出し側 `apps/server/piano_coach/voice/` で済ませる。
- `GET /health` -> `{"ok": true, "model": "..."}`
- 合成は asyncio.Lock で直列化している（MPS で同時に推論しない）。
- 環境変数: `TTS_PORT`、`TTS_MODEL`、`TTS_DEVICE`、`TTS_CODEC_DEVICE`、`TTS_PRECISION`、
  声の設定: `TTS_REF_LATENT`（参照 latent の `.pt`。既定 `tts/voice/teacher_ref.pt`。`none` で無効＝キャプションだけの声）、
  `TTS_DURATION_SCALE`（既定 0.9。1.0 で従来の速さ）、`TTS_STEPS`（既定: モデルの既定の 4）、`TTS_CAPTION`、`TTS_SEED`（既定 1234）。
  従来の声に戻すには `TTS_REF_LATENT=none TTS_DURATION_SCALE=1.0` を付けて起動する。
- `/health` は `ref_latent`、`steps`、`duration_scale`、`seed` も返す（再起動後に新設定で動いているかの確認用）。
