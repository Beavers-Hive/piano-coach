# サーバー（Codex）

先生との対話・楽譜画像の解析・運指設計は Codex CLI で実行する。
事前に `codex login` で ChatGPT にログインする。
`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`CODEX_API_KEY` が設定されていると起動を拒否する。

```sh
cd apps/server
uv run piano-coach-server
```

- `PIANO_COACH_CODEX_BIN`: CLI のパス。未指定時はアプリ同梱 CLI（`CODEX_CLI_PATH`）、次に PATH の `codex`。
- `PIANO_COACH_CODEX_MODEL`: 対話と解析のモデル（既定 `gpt-6.1-sol`）。
- `PIANO_COACH_CODEX_FINGERING_MODEL`: 運指用モデル。未指定時は上記モデル。
- `PIANO_COACH_FINGERING_EFFORT`: 運指の推論量（既定 `high`）。対話は `low`。
- `PIANO_COACH_FAKE_BRAIN=1`: テスト用の既存の台本を使用。

一時ディレクトリから、ユーザー設定・プロジェクト設定・プラグインを読み込まずに実行する。
会話履歴はメモリに保持して毎回渡す。保存済みレッスンの復元は既存の `[RESUME]` で行う。
CLI の最終応答を受け取ってから字幕・TTS に送るため、トークン単位の逐次配信は行わない。
失敗・タイムアウト時は既存の代行処理を使用し、CLI プロセスを回収する。

通信形式は既存のまま。`/api/health` の `claude` キーは通信契約のため維持する。
解析・運指の既存キャッシュも使用する。Codex で運指を作り直す場合は既存の再設計機能を使う。

検証:

```sh
uv run pytest -q
uv run python scripts/smoke_brain.py
```

実装根拠: [Codex の非対話実行](https://developers.openai.com/codex/noninteractive)。
