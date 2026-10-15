import { saveGuidePrefs, useAppStore } from "../state/store";
import "./guide.css";

/**
 * 演奏モード（自分でテンポに合わせて弾く）の「合わせる目安」の音の、入り切り。
 * メトロノームと、お手本の音。設定はブラウザに保存して、次回も引き継ぐ。
 * 待機モード（正しい鍵盤を待ってくれる）では鳴らさないので、そのことも表示する。
 */
export function GuideToggles() {
  const metronome = useAppStore((state) => state.guideMetronome);
  const notes = useAppStore((state) => state.guideNotes);
  const mode = useAppStore((state) => state.timeline?.spec.mode);
  const set = useAppStore((state) => state.set);
  if (!mode || mode === "watch") return null;
  const applies = mode === "play";

  const toggle = (key: "guideMetronome" | "guideNotes") => {
    const next = {
      guideMetronome: metronome,
      guideNotes: notes,
      [key]: !(key === "guideMetronome" ? metronome : notes),
    };
    set(next);
    saveGuidePrefs(next);
  };

  return (
    <div
      className={`guide-toggles${applies ? "" : " idle"}`}
      role="group"
      aria-label="合わせる目安の音"
    >
      <span className="guide-label">
        {applies ? "合わせる音" : "待機モードでは鳴りません"}
      </span>
      <button
        type="button"
        className={`guide-chip${metronome ? " on" : ""}`}
        aria-pressed={metronome}
        disabled={!applies}
        onClick={() => toggle("guideMetronome")}
      >
        <i aria-hidden="true" />
        メトロノーム
      </button>
      <button
        type="button"
        className={`guide-chip${notes ? " on" : ""}`}
        aria-pressed={notes}
        disabled={!applies}
        onClick={() => toggle("guideNotes")}
      >
        <i aria-hidden="true" />
        お手本の音
      </button>
    </div>
  );
}
