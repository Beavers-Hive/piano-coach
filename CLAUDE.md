# piano-coach

## Google Cloud版（2026-10-15）

`feat/gemini-cloud-run`ではGemini / Cloud Run対応を行う。現在の起動経路はGeminiBrain、音声はGoogle Cloud Text-to-Speech。Cloud Run用の構成と起動方法はREADME.mdとdocs/cloud-run.mdを優先する。下記のClaude / Irodori専用の制約は従来のローカル版に対するもの。既存の通信形式を維持し、`/api/health`の`claude`は互換キーとして残す。

PDF の楽譜を渡すと、AI の先生が 3D で指導してくれるピアノ練習アプリ（ハッカソン用、ローカルで動かす）。

- 仕様: docs/DESIGN.md
- **今夜の作業範囲と優先度: docs/02-tonight-plan.md（DESIGN.md より優先する）**
- **フロント・サーバー・TTS の間の取り決め（通信形式とデータ型）: docs/contracts.md（最優先。勝手に変えない）**
- デモ曲: assets/scores/minuet-g（PDF / MIDI / LilyPond、パブリックドメイン）

## 構成
- `apps/web`: Vite + React + React Three Fiber + zustand + Tone.js。Web MIDI を使うので Chrome 前提
- `apps/server`: Python + FastAPI + WebSocket。claude-agent-sdk でエージェントを動かす
- TTS: `vendor/Irodori-TTS` の venv（Python 3.10、torch）で動く別プロセス。ポート 8790

## 落とし穴（2026-10-15 の検証で判明。必ず守る）
- **ClaudeAgentOptions には、必ず `strict_mcp_config=True`、`tools=[]`、`setting_sources=[]` を付ける。** 付けないと claude.ai のコネクタ（約 300 個のツール）が混入し、文脈が約 21 万トークンに膨らんで応答が 8〜10 秒かかる。さらに、メール送信などのツールまで先生役が持ってしまう。詳細は DESIGN.md §10.7。
- **`ANTHROPIC_API_KEY` が設定されていたら、起動を止める。** 設定されているとサブスクではなく API 課金になる。
- エージェントにアクションの列挙を明示しないと、勝手なアクション名を作る。出力は必ずスキーマで検証する。
- 入力の JSON のキー名は、意味が明確なものにする。`weak: 3` は「3 番の指」と誤解された。
- **Irodori は「弾いて」を「はじいて」と読む。** 合成の前に、弾く系の語をひらがなに置き換える（DESIGN.md §12.1）。
- Irodori を起動するときは `HF_HUB_DISABLE_IMPLICIT_TOKEN=1` を付ける。`~/.cache/huggingface/token` が無効なため、付けないと 401 エラーになる。
- Irodori のモデルは `Aratako/Irodori-TTS-v4.1-Small-MF`。MPS で fp32 を使う。キャプションと seed（1234）は DESIGN.md §12.1 のとおり。
- 参考コード: `spikes/agent_sdk_isolated.py`（SDK の正しい設定）、`spikes/irodori_bench.py`（TTS の呼び出し方）

## 進め方
- 部品を作り込む前に、端から端まで通すことを優先する。
- 複数のエージェントが並行して作業している。**自分の担当ディレクトリの外は変更しない。**
- **git commit はしない**（統合担当がまとめてコミットする）。
- サーバーの Python パッケージは `apps/server/piano_coach/`（フラットレイアウト）に置く。
