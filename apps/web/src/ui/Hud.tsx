import { useRef, type ReactElement } from "react";
import { playDemo, startPractice } from "../midi/Player";
import { useAppStore } from "../state/store";
import { send } from "../state/ws";
import type { CameraPreset } from "../types";
import { CountIn } from "./CountIn";
import { toggleFullscreen } from "./fullscreen";
import { Dialogue, GenerationIndicator, StatusChip } from "./Dialogue";
import {
  IconCloseup,
  IconDemo,
  IconFullscreen,
  IconKeys,
  IconOverview,
  IconPlay,
  IconUpload,
  LogoMark,
} from "./icons";
import { DRILL_LABEL, STATE_LABEL, STATE_TONE, idleStatus } from "./labels";
import { ResultCard } from "./ResultCard";
import { Roadmap } from "./Roadmap";
import { SongIntro } from "./SongIntro";
import { useSongIntro } from "./introState";
import { GuideToggles } from "./GuideToggles";
import { ViewModeToggle } from "./ViewModeToggle";

const CAMERAS: { id: CameraPreset; label: string; icon: ReactElement }[] = [
  { id: "overview", label: "全体", icon: <IconOverview /> },
  { id: "play", label: "演奏", icon: <IconPlay /> },
  { id: "closeup", label: "寄り", icon: <IconCloseup /> },
];

export function Hud({
  songs,
  onSong,
}: {
  songs: { songId: string; title: string; composer: string }[];
  onSong: (id: string) => void;
}) {
  const s = useAppStore();
  const file = useRef<HTMLInputElement>(null);
  const canPlayDemo =
    Boolean(s.timeline?.notes.length) &&
    !s.running &&
    !s.generation &&
    s.voiceLevel === 0 &&
    ["briefing", "demo"].includes(s.lessonState);
  const upload = async (f?: File) => {
    if (!f) return;
    const body = new FormData();
    body.append("file", f);
    const r = await fetch("/api/songs", { method: "POST", body });
    if (r.ok) {
      const { songId } = (await r.json()) as { songId: string };
      onSong(songId);
    } else s.set({ error: "この PDF はデモ用 MIDI と一致しません" });
  };

  // 先生の字幕。演奏中の短い案内は、3D を隠さない小さな状態表示にする
  const counting = s.countInBeat !== null;
  const playing = s.lessonState === "practicing";
  const teacherSpeaking = Boolean(s.subtitle) && !playing && !counting;
  const status = s.subtitle
    ? playing
      ? s.subtitle
      : null
    : counting || s.question
      ? null
      : idleStatus(s.lessonState, s.waitingForStart);
  const drill = s.timeline?.spec.drill;
  // 曲の導入（タイトルカード）のあいだは、中央と下部を空けて、幕が上がるのを見せる
  const intro = useSongIntro((state) => state.phase !== "off");
  const belowScore = s.viewMode !== "notes" && s.timeline !== null;

  return (
    <div
      className={`hud${teacherSpeaking && !intro ? " has-band" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(e.dataTransfer.files[0]);
      }}
    >
      <header>
        <div className="brand">
          <LogoMark />
          <span>
            Piano <em>Coach</em>
          </span>
        </div>
        <span
          className={`state ${STATE_TONE[s.lessonState]}`}
          data-state={s.lessonState}
        >
          <i />
          {STATE_LABEL[s.lessonState]}
          {/* 内部の状態名（E2E と開発時の確認用。画面には出さない） */}
          <span hidden>{s.lessonState}</span>
        </span>
        {drill && (
          <div className="drill-badge" role="status" key={drill.kind}>
            <b>基礎練習</b>
            <span>{DRILL_LABEL[drill.kind]}</span>
          </div>
        )}
        <label className="song-select">
          <select
            aria-label="曲を選択"
            onChange={(e) => onSong(e.target.value)}
            defaultValue=""
          >
            <option value="" disabled>
              曲を選択
            </option>
            {songs.map((song) => (
              <option key={song.songId} value={song.songId}>
                {song.title} — {song.composer}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ghost"
          onClick={() => file.current?.click()}
          title="楽譜の PDF をドロップ、または選択"
        >
          <IconUpload />
          PDF をドロップ / 選択
        </button>
        <input
          ref={file}
          hidden
          type="file"
          accept="application/pdf"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </header>
      {s.plan && !intro && <Roadmap plan={s.plan} belowScore={belowScore} />}
      {s.combo > 1 && (
        <div className="combo">
          <b key={s.combo}>{s.combo}</b>
          <small>連続 Perfect</small>
        </div>
      )}
      <CountIn />
      <ResultCard />
      <SongIntro />
      {s.question && !intro && (
        <Question
          key={s.question.questionId}
          question={s.question}
          onAnswer={(text) => {
            send("hearing.answer", {
              questionId: s.question?.questionId,
              answer: text,
            });
            s.set({ question: undefined });
          }}
        />
      )}
      {(!intro || s.generation) && (
        <div className="bottom-stack">
          {s.generation && <GenerationIndicator phase={s.generation} />}
          {!intro &&
            !s.generation &&
            s.waitingForStart &&
            s.handsMode !== "demo" && (
              <button className="start" onClick={startPractice}>
                <IconKeys />
                鍵盤を押してスタート
              </button>
            )}
          {!intro &&
            (teacherSpeaking ? (
              <Dialogue text={s.subtitle} />
            ) : (
              !s.generation && status && <StatusChip text={status} />
            ))}
        </div>
      )}
      <div className="controls">
        <GuideToggles />
        <ViewModeToggle />
        <button
          className="demo"
          disabled={!canPlayDemo}
          onClick={() => playDemo(true)}
          aria-label="お手本を再生"
        >
          <IconDemo />
          お手本を再生
        </button>
        <div className="camera-group" role="group" aria-label="カメラ">
          {CAMERAS.map((camera) => (
            <button
              key={camera.id}
              className={`icon${s.camera === camera.id ? " active" : ""}`}
              aria-label={camera.label}
              aria-pressed={s.camera === camera.id}
              title={camera.label}
              // お手本中に押したときは、自動カメラを止めて、選んだ視点に固定する（次のお手本で自動に戻る）
              onClick={() => s.set({ camera: camera.id, cameraAuto: false })}
            >
              {camera.icon}
              <span className="tip">{camera.label}</span>
            </button>
          ))}
          <button
            className="icon"
            aria-label="全画面"
            title="全画面（Cmd+Shift+F）"
            onClick={() => void toggleFullscreen()}
          >
            <IconFullscreen />
            <span className="tip">全画面</span>
          </button>
        </div>
      </div>
      {s.hit?.kind === "miss" && <div key={s.hit.at} className="miss-flash" />}
    </div>
  );
}

/** 演目の番号。明朝の漢数字で、プログラムのように並べる。 */
const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八"];

function Question({
  question,
  onAnswer,
}: {
  question: NonNullable<ReturnType<typeof useAppStore.getState>["question"]>;
  onAnswer: (text: string) => void;
}) {
  return (
    <div className="question" role="dialog" aria-label="先生からの質問">
      <p className="eyebrow">先生からの質問</p>
      <p className="q-text">{question.text}</p>
      <div className={`q-options${question.options.length > 3 ? " wide" : ""}`}>
        {question.options.map((option, index) => (
          <button
            key={option}
            className="q-option"
            onClick={() => onAnswer(option)}
          >
            <span className="q-index">{NUMERALS[index] ?? index + 1}</span>
            <span className="q-label">{option}</span>
            <span className="q-arrow" aria-hidden="true">
              →
            </span>
          </button>
        ))}
      </div>
      {question.allowFree && (
        <form
          className="q-free"
          onSubmit={(e) => {
            e.preventDefault();
            const text = new FormData(e.currentTarget).get("answer");
            if (typeof text === "string" && text) onAnswer(text);
          }}
        >
          <input name="answer" placeholder="自由に入力" autoComplete="off" />
          <button>送信</button>
        </form>
      )}
    </div>
  );
}
