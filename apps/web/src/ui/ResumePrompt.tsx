import { useEffect, useRef, type KeyboardEvent } from "react";
import { relativeTimeJa } from "./relativeTime";
import { useResumePrompt } from "./resumeState";

/**
 * 「前回の続きから始めますか？」のカード。
 * 保存済みの進捗がある曲を開くときに、画面の中央に出す。
 * 既定のフォーカスは「続きから」。Tab は 2 つのボタンの間で回り、Esc は何もしない（どちらかを選ぶ）。
 */
export function ResumePrompt({
  onChoose,
}: {
  onChoose: (songId: string, resume: boolean) => void;
}) {
  const phase = useResumePrompt((state) => state.phase);
  const target = useResumePrompt((state) => state.target);
  const primary = useRef<HTMLButtonElement>(null);
  const secondary = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  const open = phase === "open";
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    primary.current?.focus();
    return () => {
      // 閉じたら、開く前にあった場所へフォーカスを戻す
      const previous = opener.current;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [open, target?.songId]);

  if (phase === "off" || !target) return null;
  const { progress } = target;
  const count = Math.max(1, progress.stepCount);
  const current = Math.min(count, Math.max(1, progress.stepIndex + 1));
  const disabled = phase !== "open";

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    const first = primary.current;
    const last = secondary.current;
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (
      document.activeElement !== first &&
      document.activeElement !== last
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={`resume-scrim${phase === "closing" ? " leaving" : ""}`}
      onKeyDown={onKeyDown}
    >
      <div
        className="resume-card"
        role="dialog"
        aria-modal="true"
        aria-label="前回の続きから始めますか？"
      >
        <p className="resume-kicker">前回の続き</p>
        <i className="resume-rule" />
        <h2 className="resume-title">{target.title}</h2>
        {target.composer && (
          <p className="resume-composer">{target.composer}</p>
        )}

        <div className="resume-progress">
          <p className="resume-step">
            <span className="resume-step-label">本日のプログラム</span>
            <b>
              {current} <small>/ {count}</small>
            </b>
            <span className="resume-step-title">{progress.stepTitle}</span>
          </p>
          <ol
            className="resume-meter"
            role="img"
            aria-label={`${count} ステップ中の ${current} ステップ目`}
          >
            {Array.from({ length: count }, (_, index) => (
              <li
                key={index}
                className={
                  index < current - 1
                    ? "done"
                    : index === current - 1
                      ? "doing"
                      : undefined
                }
              />
            ))}
          </ol>
        </div>

        <dl className="resume-facts">
          {progress.goal && (
            <div>
              <dt>目標</dt>
              <dd>{progress.goal}</dd>
            </div>
          )}
          <div>
            <dt>最終更新</dt>
            <dd>{relativeTimeJa(progress.updatedAt)}</dd>
          </div>
        </dl>

        <p className="resume-ask">前回の続きから始めますか？</p>
        <div className="resume-actions">
          <button
            ref={primary}
            className="resume-primary"
            disabled={disabled}
            onClick={() => onChoose(target.songId, true)}
          >
            続きから
          </button>
          <button
            ref={secondary}
            className="resume-secondary"
            disabled={disabled}
            onClick={() => onChoose(target.songId, false)}
          >
            最初から
          </button>
        </div>
      </div>
    </div>
  );
}
