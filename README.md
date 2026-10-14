# piano-coach

楽譜の PDF を渡すだけで、AI の先生が専属でピアノを教えてくれるアプリ（ハッカソンのデモ用、ローカルで動かす）。

- 先生は **Claude**（サブスクでログインした Claude Code を、claude-agent-sdk 経由で動かす）
  - ヒアリング、指導計画の作成、講評、次の課題の決定をする
  - 楽譜の画像から曲の構造を読み取る
  - 運指を設計する
- 先生の声は、ローカルで動かす **Irodori-TTS**
- 画面は、3D の鍵盤、奥から流れてくるノーツ、運指どおりに弾くホログラムの手
- MIDI キーボード（Roland JUNO-DS88 で確認）の演奏を、その場で判定する

設計は [docs/DESIGN.md](docs/DESIGN.md)、通信の取り決めは [docs/contracts.md](docs/contracts.md) にある。

## 起動（デモ前に 3 つ立ち上げる）

前提:
- macOS（Apple Silicon）と Chrome
- Claude Code にサブスクでログイン済みであること。`ANTHROPIC_API_KEY` が設定されていると起動しない（API 課金を防ぐため）
- `vendor/Irodori-TTS` で `uv sync --extra cpu` 済みであること

```bash
# 1. 先生の声（Irodori-TTS）。モデルの読み込みに 15〜80 秒かかる
cd vendor/Irodori-TTS && HF_HUB_DISABLE_IMPLICIT_TOKEN=1 uv run --no-sync python ../../tts/server.py
```

```bash
# 2. サーバー（127.0.0.1:8787）
cd apps/server && uv run piano-coach-server
```

```bash
# 3. 画面（127.0.0.1:5173）
cd apps/web && npm run dev
```

Chrome で http://127.0.0.1:5173 を開く。

準備画面では、次の 4 つを確認する。
- 「音声を有効にして準備する」を押す
- MIDI ポートで JUNO-DS88 を選ぶ
- 「先生の声をテスト」が **Irodori の声で鳴ること**（赤い警告が出たら、手順 1 の TTS を確認する）
- Claude と Irodori が「接続中」になっていること

**デモ曲の解析と運指は、事前に作っておく**（作っておかないと、初回はレッスン中に裏で設計するため数分かかる）。

```bash
cd apps/server && uv run python scripts/precompute_song_cache.py
```

## デモの流れ（3 分）

1. 曲を選ぶ（または `assets/scores/minuet-g/anna-magdalena-04-a4.pdf` をドロップする）→ 先生が曲を紹介して、ヒアリングを始める
2. ヒアリングに 2 問答える（例: 「はじめて」「右手から」）→ 指導計画が左に出る
3. お手本 → ホログラムの手が運指どおりに弾く（指くぐりはスローとクローズアップ）
4. 鍵盤を押してスタート → 落ちてくるノーツに合わせて弾く（正解で光の粒、連続正解でコンボ）
5. 先生が講評して、次の課題に進む

## テスト

```bash
cd apps/server && uv run pytest -q                       # サーバーの単体・結合テスト
cd apps/web && npm run test                              # フロントの単体テスト（Vitest）
cd apps/web && npm run test:e2e                          # E2E（フェイクの Claude と TTS。データは data-e2e/ に分離）
cd apps/web && npx playwright test -c playwright.visual.config.ts   # 見た目の撮影（test-results/visual/）
# 本物の Claude と Irodori での通し（利用枠を使う。手順 1〜2 のサーバーを先に起動しておく）
cd apps/web && PIANO_COACH_REAL=1 npx playwright test -c playwright.real.config.ts
```

## うまくいかないとき

| 症状 | 対処 |
|---|---|
| 先生の声が機械っぽい（ブラウザの声） | Irodori が落ちているか遅い。画面左下の赤い警告を確認し、手順 1 を再起動する |
| 曲を選んでも何も始まらない | サーバー（手順 2）のログを確認する。`/api/health` が `{"claude": true, "tts": true}` か確認する |
| 3D が真っ黒に見える | Claude デスクトップアプリのブラウザペインが非表示だと、スクリーンショットが黒くなる（実際の Chrome では問題ない） |
| MIDI が使えない | Chrome で MIDI の許可を確認する。PC のキーボード（A〜K、W/E/T/Y/U）でも演奏できる |
| Hugging Face の 401 エラー | `HF_HUB_DISABLE_IMPLICIT_TOKEN=1` を付けて TTS を起動する |
