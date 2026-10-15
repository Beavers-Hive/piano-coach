import { create } from "zustand";
import type { SavedProgress, SongEntry } from "../types";

/**
 * 再開カード（「前回の続きから始めますか？」）の状態。
 * open: 出ている／ closing: 消えるアニメーション中（約 0.25 秒）／ off: 出ていない
 */
export type ResumePhase = "off" | "open" | "closing";
export type ResumeTarget = {
  songId: string;
  title: string;
  composer: string;
  progress: SavedProgress;
};

export const useResumePrompt = create<{
  phase: ResumePhase;
  target: ResumeTarget | null;
}>(() => ({ phase: "off", target: null }));

const LEAVE_MS = 260;
let leaveTimer: number | undefined;

export function showResumePrompt(target: ResumeTarget) {
  window.clearTimeout(leaveTimer);
  useResumePrompt.setState({ phase: "open", target });
}

export function closeResumePrompt() {
  if (useResumePrompt.getState().phase !== "open") return;
  useResumePrompt.setState({ phase: "closing" });
  leaveTimer = window.setTimeout(
    () => useResumePrompt.setState({ phase: "off", target: null }),
    LEAVE_MS,
  );
}

/** 続きがある（null でなく、最後まで終えていない）曲だけを、ResumeTarget にする。 */
export function resumeTargetOf(song?: SongEntry): ResumeTarget | null {
  const progress = song?.progress;
  if (!song || !progress || progress.finished) return null;
  return {
    songId: song.songId,
    title: song.title,
    composer: song.composer,
    progress,
  };
}

/** 保存済みの進捗がある曲のうち、updatedAt がいちばん新しいもの。 */
export function newestResumable(songs: SongEntry[]): ResumeTarget | null {
  let best: ResumeTarget | null = null;
  for (const song of songs) {
    const target = resumeTargetOf(song);
    if (!target) continue;
    if (
      !best ||
      Date.parse(target.progress.updatedAt) >
        Date.parse(best.progress.updatedAt)
    )
      best = target;
  }
  return best;
}
