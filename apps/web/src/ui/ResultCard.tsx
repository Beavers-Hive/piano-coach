import { useEffect, useState } from "react";
import { useAppStore } from "../state/store";
import { accuracyOf, gradeOf } from "./labels";

const SHOW_MS = 4000;
const COUNT_MS = 1500;

/** 0 → value を、減速しながら数え上げる。 */
function useCountUp(value: number, delay = 250): number {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setCurrent(value);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / COUNT_MS));
      setCurrent(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay]);
  return current;
}

/** 演奏が終わった直後に、結果を 4 秒だけ見せるカード。 */
export function ResultCard() {
  const result = useAppStore((s) => s.lastResult);
  const [visibleAt, setVisibleAt] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!result) return;
    setVisibleAt(result.at);
    setLeaving(false);
    const leave = window.setTimeout(() => setLeaving(true), SHOW_MS - 450);
    const hide = window.setTimeout(() => setVisibleAt(null), SHOW_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(hide);
    };
  }, [result]);

  if (!result || visibleAt !== result.at) return null;
  return (
    <div className={`result-layer${leaving ? " leaving" : ""}`}>
      <Card
        key={result.at}
        summary={result.summary}
        leaving={leaving}
        onClose={() => setVisibleAt(null)}
      />
    </div>
  );
}

function Card({
  summary,
  leaving,
  onClose,
}: {
  summary: NonNullable<
    ReturnType<typeof useAppStore.getState>["lastResult"]
  >["summary"];
  leaving: boolean;
  onClose: () => void;
}) {
  const accuracy = accuracyOf(summary);
  const grade = gradeOf(accuracy);
  const shown = useCountUp(accuracy, 250);
  const perfect = useCountUp(summary.perfect, 500);
  const good = useCountUp(summary.good, 650);
  const miss = useCountUp(summary.miss, 800);
  const circumference = 2 * Math.PI * 54;
  const top = accuracy >= 95;
  return (
    <div
      className={`result${leaving ? " leaving" : ""}${top ? " top" : ""}`}
      role="status"
      onClick={onClose}
    >
      <p className="eyebrow">RESULT</p>
      <div className="result-main">
        <div className="result-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7fe8ff" />
                <stop offset="1" stopColor={top ? "#ff7cc0" : "#4a8dff"} />
              </linearGradient>
            </defs>
            <circle className="track" cx="60" cy="60" r="54" />
            <circle
              className="bar"
              cx="60"
              cy="60"
              r="54"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - shown / 100)}
            />
          </svg>
          <div className="result-pct">
            <b>{shown}</b>
            <span>%</span>
          </div>
          <small>正確さ</small>
        </div>
        <div className="result-side">
          <h2 className="result-grade">{grade.title}</h2>
          <p>{grade.sub}</p>
          <dl className="result-stats">
            <div className="perfect">
              <dt>Perfect</dt>
              <dd>{perfect}</dd>
            </div>
            <div className="good">
              <dt>Good</dt>
              <dd>{good}</dd>
            </div>
            <div className="miss">
              <dt>Miss</dt>
              <dd>{miss}</dd>
            </div>
          </dl>
        </div>
      </div>
      {top && <span className="result-glint" aria-hidden="true" />}
    </div>
  );
}
