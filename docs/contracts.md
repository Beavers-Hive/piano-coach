# 実装の契約（今夜版）

フロント（apps/web）、サーバー（apps/server）、TTS（tts/）は別々のエージェントが並行して作る。
**このファイルに書いた形式だけで通信すること。** 変更が必要な場合は、勝手に変えずに報告する。
DESIGN.md と食い違う場合は、このファイルを優先する。

## ポートと起動

| プロセス | ポート | 起動 |
|---|---|---|
| web（Vite） | 5173 | `cd apps/web && npm run dev` |
| server（FastAPI + WS） | 8787 | `cd apps/server && uv run piano-coach-server` |
| tts（Irodori） | 8790 | `cd vendor/Irodori-TTS && HF_HUB_DISABLE_IMPLICIT_TOKEN=1 uv run --no-sync python ../../tts/server.py` |

- すべて `127.0.0.1` にバインドする。
- web は `/api` と `/ws` を、Vite の proxy で 8787 に転送する。

## 共通の型（TypeScript で表記。Python 側は pydantic で同じ形にする）

```ts
type Hand = "right" | "left";
type Finger = 1 | 2 | 3 | 4 | 5;

type ScoreNote = {
  id: string;            // "R-0001" / "L-0001"（手ごと、時刻順の連番）
  pitch: number;         // MIDI ノート番号
  startTick: number;     // 曲頭からの tick（ppq = 480）
  durationTick: number;
  hand: Hand;            // MIDI トラック 1 = right、トラック 2 = left
  measure: number;       // 1 始まり
  beat: number;          // 小節内の拍（1 始まり、小数あり。例: 2.5）
  finger?: Finger;
  fingerSource?: "agent" | "estimated";
};

type ScoreModel = {
  songId: string;
  title: string;
  composer: string;
  ppq: 480;
  timeSignature: { num: number; den: number };   // 今夜は曲中で一定とする
  bpm: number;                                   // 四分音符基準。MIDI の最初のテンポ
  keyFifths: number;                             // 例: G major = 1
  measures: { index: number; startTick: number; endTick: number }[];
  notes: ScoreNote[];
};

type ExerciseSpec = {
  measures: [number, number];
  hand: "right" | "left" | "both";
  tempoPercent: number;          // 30〜120
  mode: "watch" | "wait" | "play";
  loop: number;                  // 1〜4
  metronome: boolean;
  focus?: string;
  drill?: DrillSpec;             // 基礎練習のときだけ（下の DrillSpec）
};

// 基礎練習（楽譜とは関係のない練習）。ExerciseSpec.drill があるとき、measures は無視して、Builder がこの指定から音符を作る。
type DrillSpec = {
  kind: "five_finger"   // 5 本の指で隣り合う 5 音を上り下り（例: ド レ ミ ファ ソ ファ ミ レ ド）
      | "rhythm"        // 1 つの音で、決まったリズムを打つ（例: 四分・四分・八分八分・四分）
      | "scale";        // 1 オクターブの音階を上り下り（親指くぐりの練習）
  startPitch: number;   // 開始音（MIDI ノート番号）。five_finger と scale では最低音
  key?: "C" | "G" | "F" | "D";  // scale と five_finger の調（既定は C）。白鍵中心の調だけ
  rhythm?: string;      // rhythm のときのパターン。"q q e e q" のように q=四分、e=八分、h=二分、r=四分休符
  bars: number;         // 繰り返す小節数（1〜4）
};

type TimelineNote = {
  playId: string;                // `${sourceNoteId}#${loopIndex}`
  sourceNoteId: string;
  measure: number;
  loopIndex: number;
  pitch: number;
  startMs: number;               // 課題の先頭（カウントインの直後）を 0 とするミリ秒
  durationMs: number;
  hand: Hand;
  finger?: Finger;
};

type FingeringEvent = {
  noteId: string;                // ScoreNote.id
  type: "thumb_under" | "finger_over" | "position_shift" | "stretch";
  measure: number;
  tip: string;                   // 日本語の短い解説
};

type ExerciseTimeline = {
  exerciseId: string;
  exerciseVersion: number;
  spec: ExerciseSpec;
  bpm: number;                   // tempoPercent を適用した後の値
  beatsPerMeasure: number;
  countInMs: number;             // カウントイン 1 小節分の長さ
  notes: TimelineNote[];         // startMs の昇順
  fingeringEvents: FingeringEvent[];  // この範囲に含まれるもの
};

type MidiEvent = { t: number; kind: "on" | "off" | "pedal"; pitch: number; velocity: number };
// t: 課題の先頭（practice.started の t0）からの相対ミリ秒。MIDIMessageEvent.timeStamp を基準にする

type RealtimeSummary = {
  total: number; perfect: number; good: number; miss: number; extra: number;
  timingMeanMs: number | null;   // 符号付き。正 = 遅い（play モードのみ。wait では null）
  timingStdMs: number | null;
  perMeasure: { measure: number; miss: number; extra: number; meanAbsMs: number | null }[];
  aborted: boolean;
};

type PlanStep = { id: string; title: string; description: string; status: "todo" | "doing" | "done" };
type Plan = { goal: string; steps: PlanStep[]; currentStepId: string | null };

type LessonState = "idle" | "importing" | "analyzing" | "hearing" | "planning"
                 | "briefing" | "demo" | "practicing" | "reviewing" | "finished";
```

## WebSocket（`/ws`）

すべてのメッセージを `{ "type": string, "payload": object }` の形で送る。

### Server → Client

| type | payload | 説明 |
|---|---|---|
| lesson.state | `{ state: LessonState }` | 状態が変わるたびに送る |
| import.progress | `{ stage: "reading" \| "analyzing" \| "fingering", ratio: number }` | 演出用 |
| song.ready | `{ score: ScoreModel, pageImageUrls: string[] }` | ScoreModel の確定時 |
| song.analysis | `{ title: string, summary: string, sections: { name: string, measures: [number, number] }[] }` | Claude による構造解析 |
| fingering.updated | `{ fingers: { id: string, finger: Finger, source: "agent" \| "estimated" }[], events: FingeringEvent[], done: boolean }` | 部分的な結果も送る。フロントは受信した順に番号を灯す |
| agent.say | `{ utteranceId: string, delta: string, final: boolean }` | 字幕用のテキスト差分 |
| voice.clip | `{ utteranceId: string, seq: number, url: string \| null, text: string, last: boolean }` | `url` が null のときは、フロントが Web Speech API で `text` を読み上げる |
| agent.ask | `{ questionId: string, text: string, options: string[], allowFree: boolean }` | ヒアリング |
| plan.updated | `{ plan: Plan }` | |
| exercise.ready | `{ timeline: ExerciseTimeline }` | Briefing に入る |
| demo.play | `{ exerciseId: string, exerciseVersion: number }` | 直前の timeline をお手本として再生する |
| ui.hint | `{ highlightMeasures?: number[], cameraPreset?: "overview" \| "play" \| "closeup" \| "score" }` | |
| error | `{ message: string }` | 表示用 |

### Client → Server

| type | payload | 説明 |
|---|---|---|
| lesson.start | `{ songId: string }` | 曲を選んで開始する |
| hearing.answer | `{ questionId: string, answer: string }` | |
| user.message | `{ text: string }` | 自由入力 |
| voice.done | `{ utteranceId: string }` | 発話の再生がすべて終わった |
| demo.finished | `{ exerciseId: string, exerciseVersion: number }` | |
| practice.started | `{ exerciseId: string, exerciseVersion: number }` | カウントインが終わり、演奏が始まった |
| attempt.submit | `{ exerciseId: string, exerciseVersion: number, mode: "wait" \| "play", events: MidiEvent[], summary: RealtimeSummary }` | |

### 演奏開始までの流れ（DESIGN.md §5）

1. server が `exercise.ready` と、課題の説明の発話（`agent.say` と `voice.clip`）を送る。
2. client は、発話の再生がすべて終わったら `voice.done` を送る。画面には「どれか鍵盤を押してスタート」と出す。
3. 学習者が鍵盤を押したら、client はカウントインを鳴らし、`practice.started` を送って演奏を開始する。
4. 演奏が終わったら（最後の音の終わり + 1 小節後）、client は `attempt.submit` を送る。
5. お手本（mode = watch）の場合は、server が `demo.play` を送る。client は再生が終わったら `demo.finished` を送る。

`exerciseVersion` が現在の版と違うメッセージは、受け取った側が無視する。

## HTTP

| メソッド | パス | 応答 |
|---|---|---|
| GET | /api/songs | `{ songs: { songId, title, composer }[] }`（assets/scores の中身） |
| POST | /api/songs | multipart の `file`（PDF）→ `{ songId }`。sha256 で assets/scores の PDF と照合する。一致しない場合は 422 |
| GET | /api/songs/{songId}/pages/{n}.png | ページ画像 |
| GET | /api/tts/{hash}.wav | 生成済みの音声 |
| GET | /api/exercises/{exerciseId}/score.musicxml | その課題（抜き出したフレーズ、または基礎練習）の楽譜。MusicXML（partwise、1 パート 2 段: 1 段目＝右手のト音記号、2 段目＝左手のヘ音記号）。調・拍子・テンポ（timeline.bpm）を含む。小節番号は元の曲の番号（基礎練習は 1 から）。運指は `<fingering>` で入れる。サーバーは直近 20 件の課題を覚えておき、それ以外は 404 |
| POST | /api/voice/test | `{ engine: "irodori" \| "webspeech", urls: string[], text: string }`。準備画面の声のテスト用。必ず Irodori を通す。engine が webspeech のときは、フロントが text を Web Speech で読み、**画面に警告を出す** |
| GET | /api/health | `{ claude: bool, tts: bool }` |

## TTS サービス（tts/server.py、ポート 8790）

| メソッド | パス | 入出力 |
|---|---|---|
| POST | /synthesize | `{ "text": string, "seed"?: number }` → `audio/wav`。読み補正は呼び出し側（server）で済ませておく |
| GET | /health | `{ "ok": true, "model": string }` |

server 側の `piano_coach/voice/`（読み補正、文の分割、キャッシュ、TTS クライアント）は、TTS 担当が作る。インターフェースは次のとおり。

```python
class VoiceService:
    async def speak(self, utterance_id: str, text_stream: AsyncIterator[str]) -> AsyncIterator[VoiceClip]: ...
    async def speak_text(self, utterance_id: str, text: str) -> AsyncIterator[VoiceClip]: ...
    async def warmup_phrases(self) -> None: ...   # 定型句を事前に生成する
# VoiceClip = dataclass(utterance_id, seq, url: str | None, text, last: bool)
# url は "/api/tts/{hash}.wav"。wav は data/tts/{hash}.wav に保存する
```

## プロンプト

エージェント用のプロンプトは、リポジトリ直下の `prompts/` に置く（Opus が書く）。サーバーは読み込むだけ。

- `prompts/tutor_system.md`: レッスンセッションのシステムプロンプト
- `prompts/analyze_system.md`: 曲の構造解析
- `prompts/fingering_system.md`: 運指の設計

## 楽譜モード（フロント）

- 表示モード `viewMode`: `"notes"`（落ちてくるノーツだけ）／ `"score"`（楽譜だけ）／ `"both"`（両方）。store に置き、切り替えのボタンを画面に出す。
- 楽譜は Verovio（npm の `verovio` パッケージ。WASM を同梱し、実行時に外部へアクセスしない）で SVG に描く。
- `exercise.ready` を受けたら、`/api/exercises/{exerciseId}/score.musicxml` を取得して描く。
- 再生と演奏の間は、`getPlayheadMs()` に合わせてカーソルを動かし、いま弾く音を強調する。Verovio の timemap（MusicXML のテンポ＝timeline.bpm なので、Verovio の時刻と playhead が一致する）で、時刻と音符の要素を対応付ける。
- 判定の結果（perfect / good / miss）を、楽譜の音符の色にも反映する。
