# サーバー（Codex）

先生との対話・楽譜画像の解析・運指設計は Codex CLI で実行する。
事前に `codex login` で ChatGPT にログインする。
`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`CODEX_API_KEY` が設定されていると起動を拒否する。

```sh
cd apps/server
uv run piano-coach-server
```

- `PIANO_COACH_CODEX_BIN`: CLI のパス。未指定時はアプリ同梱 CLI（`CODEX_CLI_PATH`）、次に PATH の `codex`。
- `PIANO_COACH_CODEX_HEARING_MODEL`: 最初のヒアリング（既定 `gpt-6-luna`）。計画の生成は通常の先生モデルが担当。
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

## Gemini 3.8 Flash TTS

音声を Gemini に切り替えるときは、別のターミナルで以下を起動する。

```sh
cd apps/server
uv run python -m piano_coach.voice.gemini_server
```

API キーは `GEMINI_API_KEY` または Git 管理外の `data/secrets/gemini_api_key`（権限 600）から読む。
キーをフロントや Codex に渡すことはない。Gemini に送るのは音声合成するテキストと声の指定。

サーバーも次の設定で起動する（音声ブリッジは 8791、既存の Irodori は 8790）。

```sh
PIANO_COACH_TTS_URL=http://127.0.0.1:8791 PIANO_COACH_TTS_TIMEOUT=45 uv run piano-coach-server
```

モデルは `gemini-3.8-flash-tts`、声は `Kore`。`PIANO_COACH_GEMINI_VOICE` と
`PIANO_COACH_GEMINI_STYLE` で声・話し方を指定できる。モデル・声・話し方ごとにキャッシュを分ける。
通信契約の `engine: "irodori"` は既存の合成音声成功を示す値として維持しているため、
現在の画面にも Irodori と表示されるが、この起動設定での実際の合成は Gemini が行う。

仕様: https://ai.google.dev/gemini-api/docs/speech-generation

Gemini は発言全体をまとめて合成する（長い発言は350文字で区切る）。起動時の定型音声の事前生成は行わない。
HTTP 402・429 は30秒の待機を置き、課金・利用枠のエラーをレッスン画面に表示する。
Google 側の課金設定後は、待機時間後の次の新しい発言で再試行する。
