import { useAppStore } from "../state/store";

/** カウントイン。拍ごとに数字が弾けて、拍の長さの中で消える。 */
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
        <span className="countin-ring" />
        <span className="countin-ring second" />
        <span className="countin-digit">{beat}</span>
      </div>
      <div className="countin-tempo">
        <span>♩</span> = {bpm ?? "—"}
      </div>
    </div>
  );
}
