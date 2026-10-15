import { create } from "zustand";
import { useAppStore } from "../state/store";
import type { ScoreModel } from "../types";

/**
 * レッスン開始の演出（演奏会の「本日の曲」カードと、幕が上がるような照明）。
 * song.ready で score が届いたときに始まり、約 3.6 秒で終わる。
 * - dark: 照明を落とす（暗転）
 * - rise: 照明が少しずつ明るくなる。タイトルカードを見せる
 * - leaving: カードが消える
 * React のライフサイクルに依存しないよう、store の購読とタイマーはモジュール側で持つ。
 */
export type IntroPhase = "off" | "dark" | "rise" | "leaving";

export type IntroInfo = {
  title: string;
  composer: string;
  meter: string;
  key: string;
  measures: string;
};

type IntroState = { phase: IntroPhase; info: IntroInfo | null };

export const useSongIntro = create<IntroState>(() => ({
  phase: "off",
  info: null,
}));

const DARK_MS = 650;
const RISE_MS = 2500;
const LEAVE_MS = 600;

const MAJOR_KEYS: Record<number, string> = {
  [-7]: "変ハ長調",
  [-6]: "変ト長調",
  [-5]: "変ニ長調",
  [-4]: "変イ長調",
  [-3]: "変ホ長調",
  [-2]: "変ロ長調",
  [-1]: "ヘ長調",
  0: "ハ長調",
  1: "ト長調",
  2: "ニ長調",
  3: "イ長調",
  4: "ホ長調",
  5: "ロ長調",
  6: "嬰ヘ長調",
  7: "嬰ハ長調",
};

/** 曲名に調が入っているとき（「メヌエット ト長調」）は、調だけ下の行に回す。 */
export function introInfoOf(score: ScoreModel): IntroInfo {
  const key = MAJOR_KEYS[score.keyFifths] ?? "";
  const title = key
    ? score.title.replace(key, "").replace(/\s+/g, " ").trim()
    : score.title;
  return {
    title: title || score.title,
    composer: score.composer,
    meter: `${score.timeSignature.num}/${score.timeSignature.den} 拍子`,
    key,
    measures: `全 ${score.measures.length} 小節`,
  };
}

let timers: number[] = [];
let lastShown: { songId: string; at: number } | null = null;

function clearTimers() {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers = [];
}

export function startSongIntro(score: ScoreModel) {
  // 同じ曲の score が続けて届いたときは、演出をやり直さない
  const now = Date.now();
  if (
    lastShown &&
    lastShown.songId === score.songId &&
    now - lastShown.at < 8000
  )
    return;
  lastShown = { songId: score.songId, at: now };
  clearTimers();
  useSongIntro.setState({ phase: "dark", info: introInfoOf(score) });
  timers.push(
    window.setTimeout(() => useSongIntro.setState({ phase: "rise" }), DARK_MS),
    window.setTimeout(
      () => useSongIntro.setState({ phase: "leaving" }),
      DARK_MS + RISE_MS,
    ),
    window.setTimeout(
      () => useSongIntro.setState({ phase: "off" }),
      DARK_MS + RISE_MS + LEAVE_MS,
    ),
  );
}

if (typeof window !== "undefined") {
  useAppStore.subscribe((state, previous) => {
    if (!state.score || state.score === previous.score) return;
    startSongIntro(state.score);
  });
}
