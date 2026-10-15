import { useAppStore } from "../state/store";

/** カウントイン。明朝の数字と、指揮者のタクトのように 1 拍で 1 周する細い円弧。 */
export function CountIn() {
  const beat = useAppStore((s) => s.countInBeat);
  const bpm = useAppStore((s) => s.countInBpm);
  if (beat === null) return null;
  const beatSeconds = 60 / (bpm || 100);
  return (
    <div
      className="countin"
      aria-live="assertive"
      style={{ ["--beat" as string]: `${beatSeconds.toFixed(3)}s` }}
    >
      {/* key を拍ごとに変えて、アニメーションを最初からやり直す */}
      <div className="countin-stage" key={beat}>
        <svg className="countin-arc" viewBox="0 0 260 260" aria-hidden="true">
          <circle className="track" cx="130" cy="130" r="118" />
          <circle
            className="sweep"
            cx="130"
            cy="130"
            r="118"
            pathLength="100"
          />
        </svg>
        <span className="countin-baton">
          <i />
        </span>
        <span className="countin-digit">{beat}</span>
      </div>
      <div className="countin-tempo">
        <span>♩</span> = {bpm ?? "—"}
      </div>
    </div>
  );
}
