import { useRef } from "react";
import { playDemo, startPractice } from "../midi/Player";
import { useAppStore } from "../state/store";
import { send } from "../state/ws";
/** 先生が話していないときの字幕（状態に合わせる）。 */
function idleSubtitle(state: string, waitingForStart: boolean): string {
  if (waitingForStart) return "どれか鍵盤を押してスタート";
  switch (state) {
    case "idle":
      return "曲を選ぶか、楽譜の PDF をドロップしてください";
    case "importing":
    case "analyzing":
      return "先生が楽譜を読んでいます…";
    case "hearing":
    case "planning":
      return "先生が練習の計画を考えています…";
    case "reviewing":
      return "先生が演奏を聴いて考えています…";
    case "finished":
      return "今日のレッスンはここまで。おつかれさま！";
    default:
      return "先生があなたの演奏を待っています";
  }
}

export function Hud({
  songs,
  onSong,
}: {
  songs: { songId: string; title: string; composer: string }[];
  onSong: (id: string) => void;
}) {
  const s = useAppStore();
  const file = useRef<HTMLInputElement>(null);
  const answer = (text: string) => {
    if (s.question)
      send("hearing.answer", {
        questionId: s.question.questionId,
        answer: text,
      });
    s.set({ question: undefined });
  };
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
  return (
    <div
      className="hud"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(e.dataTransfer.files[0]);
      }}
    >
      <header>
        <div className="brand">
          PIANO <em>COACH</em>
        </div>
        <span className="state">● {s.lessonState}</span>
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
        <button onClick={() => file.current?.click()}>
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
      {s.plan && (
        <aside className="plan">
          <b>{s.plan.goal}</b>
          {s.plan.steps.map((step) => (
            <div className={step.status} key={step.id}>
              <i />
              {step.title}
            </div>
          ))}
        </aside>
      )}
      {s.fallbackVoiceAt && (
        <div className="voice-fallback" role="status">
          代替音声（ブラウザ）で再生しています — Irodori を確認してください
        </div>
      )}
      <div className="subtitle">
        {s.subtitle || idleSubtitle(s.lessonState, s.waitingForStart)}
      </div>
      {s.combo > 1 && (
        <div className="combo">
          {s.combo}
          <small>PERFECT COMBO</small>
        </div>
      )}
      {s.waitingForStart && s.handsMode !== "demo" && (
        <button className="start" onClick={startPractice}>
          鍵盤を押してスタート
        </button>
      )}
      <div className="controls">
        <button onClick={playDemo}>お手本を再生</button>
        <button onClick={() => s.set({ camera: "overview" })}>全体</button>
        <button onClick={() => s.set({ camera: "play" })}>演奏</button>
        <button onClick={() => s.set({ camera: "closeup" })}>寄り</button>
      </div>
      {s.question && (
        <div className="question">
          <p>{s.question.text}</p>
          {s.question.options.map((o) => (
            <button key={o} onClick={() => answer(o)}>
              {o}
            </button>
          ))}
          {s.question.allowFree && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = new FormData(e.currentTarget).get("answer");
                if (typeof text === "string" && text) answer(text);
              }}
            >
              <input name="answer" placeholder="自由に入力" />
              <button>送信</button>
            </form>
          )}
        </div>
      )}
      {s.hit?.kind === "miss" && <div key={s.hit.at} className="miss-flash" />}
      {s.error && <div className="error">{s.error}</div>}
    </div>
  );
}
