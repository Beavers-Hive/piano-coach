import { useEffect, useRef, useState } from "react";

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 句読点のあとに置く間（ミリ秒）。 */
function pauseAfter(char: string): number {
  if ("。！？!?".includes(char)) return 260;
  if ("、，,—…".includes(char)) return 110;
  return 0;
}

/**
 * 字幕のテキストを 1 文字ずつ出す。テキストが伸びたぶんだけ追いかけ、
 * 遅れが溜まったら速度を上げる。前のテキストの続きでなければ（新しい発話）頭から出し直す。
 */
function useTypewriter(text: string): { count: number; done: boolean } {
  const [count, setCount] = useState(() => (reducedMotion() ? text.length : 0));
  const shown = useRef(count);
  const previous = useRef("");

  useEffect(() => {
    if (!text.startsWith(previous.current)) {
      shown.current = 0;
      setCount(0);
    }
    previous.current = text;
    if (reducedMotion()) {
      shown.current = text.length;
      setCount(text.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let credit = 0;
    let pausedUntil = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (shown.current < text.length) {
        if (now >= pausedUntil) {
          const backlog = text.length - shown.current;
          const perSecond = backlog > 70 ? 120 : backlog > 36 ? 60 : 34;
          credit += (dt * perSecond) / 1000;
          let advanced = 0;
          while (credit >= 1 && shown.current + advanced < text.length) {
            credit -= 1;
            advanced += 1;
            const pause = pauseAfter(text[shown.current + advanced - 1]);
            if (pause && backlog <= 36) {
              pausedUntil = now + pause;
              break;
            }
          }
          if (advanced) {
            shown.current += advanced;
            setCount(shown.current);
          }
        }
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return { count: Math.min(count, text.length), done: count >= text.length };
}

/** ノベルゲーム風のダイアログ。画面下部に置く。 */
export function Dialogue({ text }: { text: string }) {
  const { count, done } = useTypewriter(text);
  return (
    <div className="dialogue" role="log" aria-live="polite">
      <div className="dialogue-name">
        <i />
        先生
      </div>
      <p className="subtitle">
        <span>{text.slice(0, count)}</span>
        <span className="untyped">{text.slice(count)}</span>
      </p>
      <span className={`dialogue-next${done ? " on" : ""}`} aria-hidden="true">
        ▼
      </span>
    </div>
  );
}

/** 先生が話していないときの、控えめな状態表示。 */
export function StatusChip({ text }: { text: string }) {
  return (
    <div className="status-chip" role="status">
      <i />
      <span className="subtitle">{text}</span>
    </div>
  );
}
