import type { ExerciseTimeline, TimelineNote } from "../types";
import type { HitKind } from "../state/store";

export type TimemapEntry = {
  tstamp: number;
  on: string[];
  off?: string[];
};

type RawTimemapEntry = {
  tstamp?: number;
  on?: string[];
  off?: string[];
};

/** Verovio の timemap を、描画と判定で使う安全な形に正規化する。 */
export function parseTimemap(raw: unknown): TimemapEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as RawTimemapEntry;
      if (typeof item.tstamp !== "number" || !Array.isArray(item.on)) return [];
      return [
        {
          tstamp: item.tstamp,
          on: item.on.filter((id): id is string => typeof id === "string"),
          off: Array.isArray(item.off)
            ? item.off.filter((id): id is string => typeof id === "string")
            : [],
        },
      ];
    })
    .sort((left, right) => left.tstamp - right.tstamp);
}

/** playhead 時点で鳴り始める、または直前に鳴り始めた SVG 要素 ID 群。 */
export function scoreElementsAt(
  timemap: TimemapEntry[],
  playheadMs: number,
): string[] {
  let current: TimemapEntry | undefined;
  for (const entry of timemap) {
    if (entry.tstamp > playheadMs) break;
    current = entry;
  }
  return current?.on ?? [];
}

/** 判定された MIDI ノートを、最も近い予定音と Verovio の要素に対応付ける。 */
export function scoreElementsForHit(
  timeline: ExerciseTimeline,
  timemap: TimemapEntry[],
  pitch: number,
  playheadMs: number,
): string[] {
  const scheduled = closestNote(timeline.notes, pitch, playheadMs);
  if (!scheduled) return [];
  return closestTimemapEntry(timemap, scheduled.startMs)?.on ?? [];
}

/** CSS に付ける判定クラス。extra は楽譜の予定音には紐付けない。 */
export function scoreResultClass(kind: HitKind): string | null {
  if (kind === "perfect") return "score-result-perfect";
  if (kind === "good") return "score-result-good";
  if (kind === "miss") return "score-result-miss";
  return null;
}

function closestNote(
  notes: TimelineNote[],
  pitch: number,
  playheadMs: number,
): TimelineNote | undefined {
  let result: TimelineNote | undefined;
  let distance = Infinity;
  for (const note of notes) {
    if (note.pitch !== pitch) continue;
    const nextDistance = Math.abs(note.startMs - playheadMs);
    if (nextDistance < distance) {
      result = note;
      distance = nextDistance;
    }
  }
  return result;
}

function closestTimemapEntry(
  timemap: TimemapEntry[],
  timeMs: number,
): TimemapEntry | undefined {
  let result: TimemapEntry | undefined;
  let distance = Infinity;
  for (const entry of timemap) {
    const nextDistance = Math.abs(entry.tstamp - timeMs);
    if (nextDistance < distance) {
      result = entry;
      distance = nextDistance;
    }
  }
  return result;
}
