# Cloud Run版の検証（2026-10-15）

- プロジェクト：`piano-coach-ai-20261015`
- 公開URL：<https://piano-coach-149093957006.asia-northeast1.run.app>
- 稼働リビジョン：`piano-coach-00006-fbm`
- ソース作業ブランチ：`feat/gemini-cloud-run`
- 先生：Gemini 3.5 Flash / Vertex AI
- 曲解析・運指：Gemini 3.1 Flash-Lite / Vertex AI
- 音声：Cloud Text-to-Speech / ja-JP-Neural2-B

## 結果

| 確認 | 結果 |
| --- | --- |
| Pythonの単体・結合テスト | 100件成功 |
| TypeScript / Vitest | 24件成功 |
| Viteの本番ビルド | 成功 |
| Chrome結合テスト：レッスン・PDF選択・音声確認 | 3件成功 |
| 公開Cloud Runを使うChrome通しテスト | 1件成功、約1.3分 |

公開版の通しテストでは、画面・HTTP・WebSocket・Geminiの判断・音声生成を実際に使用し、物理MIDI機器の入力だけをテスト用ポートで再現した。ヒアリング、計画、お手本、運指の部分更新、演奏の判定、講評、次の課題の表示まで確認した。

この試行では曲解析がフォールバックを使わず完了し、運指の更新を8回受信した。右手1小節のwaitモード・原曲60%での演奏後、AIが同じ範囲・速度の再練習を選択し、運指付きの次の課題が表示された。これは操作検証の結果であり、学習効果や上達速度の測定ではない。

画面キャプチャは`apps/web/test-results-real/shots/`（Git管理対象外）。実機のMIDIキーボードを使った今回のクラウド版の収録は、本人が行う。

## 再実行

```sh
cd apps/web
PIANO_COACH_REAL=1 PIANO_COACH_BROWSER_CHANNEL=chrome \
  PIANO_COACH_BASE_URL=https://piano-coach-149093957006.asia-northeast1.run.app \
  npx playwright test -c playwright.real.config.ts
```

実際のGoogle APIを使用する。テストで返る言葉や練習計画は毎回変わる。
