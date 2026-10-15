// 演奏モード（自分でテンポに合わせて弾く）の「合わせる目安」の音の予定表。
// 時刻は、カウントインの最初の拍を 0 とするミリ秒（Tone の Transport の時間）。
// 画面に依存しない純粋な計算にして、単体テストできるようにしている。

import type { ExerciseTimeline } from "../types";

export type GuideClick = {
  atMs: number;
  /** 小節の頭の拍（少し高く強いクリックにする）。 */
  accent: boolean;
  /** カウントインの拍なら、画面に出す残り拍数（3/4 拍子なら 3 → 2 → 1）。演奏中の拍は null。 */
  countInBeat: number | null;
};

export type GuideNote = {
  atMs: number;
  pitch: number;
  durationMs: number;
};

export type GuideSchedule = {
  countInMs: number;
  countInBpm: number;
  clicks: GuideClick[];
  notes: GuideNote[];
};

export type GuideOptions = {
  /** 演奏中もメトロノームを鳴らす（カウントインのクリックは、常に鳴らす）。 */
  metronome: boolean;
  /** お手本の音を鳴らす。 */
  notes: boolean;
};

function lastNoteEnd(timeline: ExerciseTimeline): number {
  return Math.max(
    0,
    ...timeline.notes.map((note) => note.startMs + note.durationMs),
  );
}

/**
 * 短いカウントイン + 演奏の間の、クリックとお手本の音の予定を作る。
 * - カウントインのクリックは、モードに関係なく入れる（画面の 3, 2, 1 と同じ時刻）。
 * - 演奏中のクリックと、お手本の音は、options に従う。
 * - 演奏は timeline.bpm のまま。カウントインは落ち着いて準備できる600ms間隔にする。
 */
export function buildGuideSchedule(
  timeline: ExerciseTimeline,
  options: GuideOptions,
): GuideSchedule {
  const beatMs = 60_000 / timeline.bpm;
  const perMeasure = timeline.beatsPerMeasure;
  const countInBeats = perMeasure;
  // 100 BPM相当の一定間隔。遅い課題でも待ち過ぎず、速い課題でも準備できる。
  const countInMs = countInBeats * 600;
  const countBeatMs = countInMs / countInBeats;
  const clicks: GuideClick[] = [];

  for (let beat = 0; beat < countInBeats; beat += 1) {
    clicks.push({
      atMs: beat * countBeatMs,
      accent: beat % perMeasure === 0,
      countInBeat: countInBeats - beat,
    });
  }
  if (options.metronome) {
    // 最後の音が終わるまでの拍（演奏の頭 = カウントインの直後が 1 拍目）
    const performanceBeats = Math.ceil(lastNoteEnd(timeline) / beatMs);
    for (let beat = 0; beat < performanceBeats; beat += 1) {
      clicks.push({
        atMs: countInMs + beat * beatMs,
        accent: beat % perMeasure === 0,
        countInBeat: null,
      });
    }
  }

  const notes: GuideNote[] = options.notes
    ? timeline.notes.map((note) => ({
        atMs: countInMs + note.startMs,
        pitch: note.pitch,
        durationMs: note.durationMs,
      }))
    : [];
  return { clicks, notes, countInMs, countInBpm: 60_000 / countBeatMs };
}

/** 演奏モードで、目安の音（メトロノームかお手本の音）を鳴らすか。待機モードは、正しい鍵盤を待つので鳴らさない。 */
export function guideIsActive(
  timeline: ExerciseTimeline,
  options: GuideOptions,
): boolean {
  return timeline.spec.mode === "play" && (options.metronome || options.notes);
}
