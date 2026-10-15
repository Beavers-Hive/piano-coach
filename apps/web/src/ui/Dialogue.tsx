import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../state/store";

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 句読点のあとに置く間（ミリ秒）。 */
function pauseAfter(char: string): number {
  if ("。！？!?".includes(char)) return 260;
  if ("、，,—…".includes(char)) return 110;
  return 0;
}

/** 声に合わせない字幕（状態の案内など）の既定の速さ（1 秒あたりの文字数）。 */
const DEFAULT_CHARS_PER_SECOND = 34;

/**
 * 字幕のテキストを 1 文字ずつ出す。
 * - 声に合わせて更新された字幕（seq が変わったとき）は、durationMs で「新しい部分」を出し切る
 *   （声が出る瞬間に始まり、声が終わるころに出し終わる）。句読点では少し間を取る。
 * - それ以外（状態の案内など）は、既定の速さで出す。
 * - 前の字幕の続き（同じ発話に文が足されたとき）は、続きから出す。続きでなければ頭から出し直す。
 */
function useTypewriter(
  text: string,
  durationMs: number | undefined,
  seq: number,
): { count: number; done: boolean } {
  const [count, setCount] = useState(() => (reducedMotion() ? text.length : 0));
  const shown = useRef(count);
  const previous = useRef("");
  const previousSeq = useRef(seq);

  useEffect(() => {
    const voiceDriven = seq !== previousSeq.current;
    previousSeq.current = seq;
    // 新しい発話（前の続きでない）、または同じ文がもう一度出てきたときは、頭から出し直す
    if (
      !text.startsWith(previous.current) ||
      (voiceDriven && text === previous.current)
    ) {
      shown.current = 0;
      setCount(0);
    }
    previous.current = text;
    if (reducedMotion()) {
      shown.current = text.length;
      setCount(text.length);
      return;
    }
    if (voiceDriven && shown.current < text.length) {
      shown.current += 1;
      setCount(shown.current);
    }
    const base = shown.current;
    const rest = text.slice(base);
    if (!rest) return;
    // 句読点の後ろは、1 文字ぶんより長く取る
    const weights = [...rest].map((char) => 1 + pauseAfter(char) / 130);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const duration =
      voiceDriven && durationMs
        ? durationMs
        : (rest.length / DEFAULT_CHARS_PER_SECOND) * 1000;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const target = progress * total;
      let accumulated = 0;
      let typed = 0;
      while (typed < rest.length && accumulated + weights[typed] <= target) {
        accumulated += weights[typed];
        typed += 1;
      }
      if (progress >= 1) typed = rest.length;
      if (base + typed > shown.current) {
        shown.current = base + typed;
        setCount(shown.current);
      }
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, durationMs, seq]);

  return { count: Math.min(count, text.length), done: count >= text.length };
}

/** ノベルゲーム風のダイアログ。画面下部に置く。 */
export function Dialogue({ text }: { text: string }) {
  const durationMs = useAppStore((state) => state.subtitleDurationMs);
  const seq = useAppStore((state) => state.subtitleSeq);
  const { count, done } = useTypewriter(text, durationMs, seq);
  return (
    <div className="dialogue" role="log" aria-live="polite">
      <div className="dialogue-inner">
        <div className="dialogue-name">先生</div>
        <p className="subtitle">
          <span>{text.slice(0, count)}</span>
          <span className="untyped">{text.slice(count)}</span>
        </p>
        <span
          className={`dialogue-next${done ? " on" : ""}`}
          aria-hidden="true"
        >
          ▼
        </span>
      </div>
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

/** CSSだけで動く軽量な生成待ち表示。通信形式や字幕の再生時刻は変えない。 */
export function GenerationIndicator({
  phase,
}: {
  phase: "thinking" | "voice";
}) {
  return (
    <div className="generation-status" role="status" aria-live="polite">
      <span className="generation-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        {phase === "thinking"
          ? "先生が考えています"
          : "先生の声を準備しています"}
      </span>
    </div>
  );
}
