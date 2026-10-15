import { useSongIntro } from "./introState";

/** 演奏会のプログラムのような、「本日の曲」のタイトルカード。 */
export function SongIntro() {
  const phase = useSongIntro((s) => s.phase);
  const info = useSongIntro((s) => s.info);
  // 暗転のあいだはカードを出さない（照明が落ち切ってから幕が上がる）
  if (phase === "off" || phase === "dark" || !info) return null;
  const meta = [info.meter, info.key, info.measures].filter(Boolean);
  return (
    <div
      className={`song-intro${phase === "leaving" ? " leaving" : ""}`}
      aria-live="polite"
    >
      <div className="song-intro-card">
        <p className="song-intro-kicker">本日の曲</p>
        <i className="song-intro-rule" />
        <h2 className="song-intro-title">{info.title}</h2>
        <p className="song-intro-composer">{info.composer}</p>
        <ul className="song-intro-meta">
          {meta.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
