import { useEffect, useState } from "react";
import { useAppStore } from "../state/store";
import { IconAlert, IconClose } from "./icons";

type Toast = { id: number; kind: "error" | "warn"; text: string };
let nextId = 1;

/** 切断のように、読まれるまで残したいメッセージ。 */
const sticky = (text: string) => /接続が切れ/.test(text);

/** エラーと警告を、画面右上の上品なトーストにまとめる。 */
export function Toasts() {
  const error = useAppStore((s) => s.error);
  const fallbackVoiceAt = useAppStore((s) => s.fallbackVoiceAt);
  const set = useAppStore((s) => s.set);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (kind: Toast["kind"], text: string) =>
    setToasts((list) =>
      list.some((toast) => toast.text === text)
        ? list
        : [...list, { id: nextId++, kind, text }].slice(-3),
    );
  const dismiss = (id: number) =>
    setToasts((list) => list.filter((toast) => toast.id !== id));

  useEffect(() => {
    if (error) push("error", error);
  }, [error]);
  useEffect(() => {
    if (fallbackVoiceAt)
      push(
        "warn",
        "代替音声（ブラウザ）で再生しています。先生の音声を取得できませんでした。",
      );
  }, [fallbackVoiceAt]);

  // 古いものから自動で消す
  useEffect(() => {
    const timers = toasts
      .filter((toast) => !sticky(toast.text))
      .map((toast) =>
        window.setTimeout(() => {
          dismiss(toast.id);
          if (toast.text === useAppStore.getState().error)
            set({ error: undefined });
        }, 8000),
      );
    return () => timers.forEach(clearTimeout);
  }, [toasts, set]);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id} role="alert">
          <span className="toast-icon">
            <IconAlert />
          </span>
          <p className="error-text">{toast.text}</p>
          <button
            className="toast-close"
            aria-label="閉じる"
            onClick={() => {
              dismiss(toast.id);
              if (toast.text === useAppStore.getState().error)
                set({ error: undefined });
            }}
          >
            <IconClose />
          </button>
        </div>
      ))}
    </div>
  );
}
