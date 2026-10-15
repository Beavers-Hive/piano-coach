import type { DrillSpec, LessonState } from "../types";

/** 画面に出す状態の日本語ラベル（内部の英語名は `.state` の data-state に残す）。 */
export const STATE_LABEL: Record<LessonState, string> = {
  idle: "待機中",
  importing: "楽譜を取り込み中",
  analyzing: "楽譜を解析中",
  hearing: "ヒアリング",
  planning: "指導計画づくり",
  briefing: "課題の説明",
  demo: "お手本",
  practicing: "演奏中",
  reviewing: "講評",
  finished: "レッスン終了",
};

/** 状態の色合い（ドット）。 */
export const STATE_TONE: Record<LessonState, "calm" | "think" | "live"> = {
  idle: "calm",
  importing: "think",
  analyzing: "think",
  hearing: "calm",
  planning: "think",
  briefing: "calm",
  demo: "live",
  practicing: "live",
  reviewing: "think",
  finished: "calm",
};

export const DRILL_LABEL: Record<DrillSpec["kind"], string> = {
  five_finger: "5本指",
  rhythm: "リズム",
  scale: "音階",
};

/** 先生が話していないときの、控えめな状態表示。null なら何も出さない。 */
export function idleStatus(
  state: LessonState,
  waitingForStart: boolean,
): string | null {
  if (waitingForStart) return null; // 「鍵盤を押してスタート」のボタンが代わりに出る
  switch (state) {
    case "idle":
      return "曲を選ぶか、楽譜の PDF をドロップしてください";
    case "importing":
    case "analyzing":
      return "先生が楽譜を読んでいます";
    case "hearing":
    case "planning":
      return "先生が練習の計画を考えています";
    case "reviewing":
      return "先生が演奏を聴いて考えています";
    case "finished":
      return "今日のレッスンはここまで。おつかれさま！";
    default:
      return "先生があなたの演奏を待っています";
  }
}

/** 演奏結果の正確さ（%）。perfect は 1、good は 0.8 として数える。 */
export function accuracyOf(summary: {
  total: number;
  perfect: number;
  good: number;
}): number {
  if (summary.total <= 0) return 0;
  const value = (summary.perfect + summary.good * 0.8) / summary.total;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function gradeOf(accuracy: number): { title: string; sub: string } {
  if (accuracy >= 95) return { title: "Excellent", sub: "ほぼ完璧な演奏です" };
  if (accuracy >= 80) return { title: "Great", sub: "とてもよく弾けています" };
  if (accuracy >= 60) return { title: "Good", sub: "いい調子。あと少しです" };
  return { title: "Keep going", sub: "ここからが練習の本番です" };
}
