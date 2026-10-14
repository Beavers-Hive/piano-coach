import type {
  ExerciseTimeline,
  MidiEvent,
  RealtimeSummary,
  TimelineNote,
} from "../types";

export type Judgement = "perfect" | "good" | "miss" | "extra";

type Result = { note?: TimelineNote; kind: Judgement; delta?: number };

/** Pure, clock-fed judgement. The caller supplies the clock playhead in ms. */
export class RealtimeJudge {
  private readonly consumed = new Set<string>();
  private readonly held = new Set<number>();
  private readonly events: MidiEvent[] = [];
  private readonly results: Result[] = [];

  constructor(private readonly timeline: ExerciseTimeline) {}

  onPlayInput(
    kind: MidiEvent["kind"],
    pitch: number,
    velocity: number,
    playheadMs: number,
  ): Judgement | undefined {
    this.events.push({ t: playheadMs, kind, pitch, velocity });
    if (kind !== "on") return undefined;

    this.expire(playheadMs);
    const note = this.timeline.notes.find(
      (candidate) =>
        candidate.pitch === pitch &&
        !this.consumed.has(candidate.playId) &&
        Math.abs(playheadMs - candidate.startMs) <= 160,
    );
    if (!note) return this.addExtra();

    this.consumed.add(note.playId);
    const delta = playheadMs - note.startMs;
    const kindResult: Judgement = Math.abs(delta) <= 80 ? "perfect" : "good";
    this.results.push({ note, kind: kindResult, delta });
    return kindResult;
  }

  /** Returns true only when a newly-pressed key completes the next chord. */
  onWaitInput(
    pitch: number,
    velocity: number,
    on: boolean,
    playheadMs: number,
  ): { kind?: Judgement; chordComplete: boolean } {
    this.events.push({
      t: playheadMs,
      kind: on ? "on" : "off",
      pitch,
      velocity,
    });
    if (!on) {
      this.held.delete(pitch);
      return { chordComplete: false };
    }
    if (this.held.has(pitch)) return { chordComplete: false };
    this.held.add(pitch);

    const next = this.timeline.notes.find(
      (note) => !this.consumed.has(note.playId),
    );
    if (!next) return { kind: this.addExtra(), chordComplete: false };
    const chord = this.timeline.notes.filter(
      (note) =>
        note.startMs === next.startMs && !this.consumed.has(note.playId),
    );
    const target = chord.find((note) => note.pitch === pitch);
    if (!target) return { kind: this.addExtra(), chordComplete: false };

    this.consumed.add(target.playId);
    this.results.push({ note: target, kind: "perfect", delta: 0 });
    return {
      kind: "perfect",
      chordComplete: chord.every((note) => this.consumed.has(note.playId)),
    };
  }

  expire(nowMs: number): TimelineNote[] {
    const missed: TimelineNote[] = [];
    for (const note of this.timeline.notes) {
      if (!this.consumed.has(note.playId) && nowMs > note.startMs + 160) {
        this.consumed.add(note.playId);
        this.results.push({ note, kind: "miss" });
        missed.push(note);
      }
    }
    return missed;
  }

  nextStartMs(): number | null {
    return (
      this.timeline.notes.find((note) => !this.consumed.has(note.playId))
        ?.startMs ?? null
    );
  }

  isComplete(): boolean {
    return this.consumed.size === this.timeline.notes.length;
  }

  finish(aborted = false): { events: MidiEvent[]; summary: RealtimeSummary } {
    this.expire(Number.POSITIVE_INFINITY);
    const timing = this.results.flatMap((result) =>
      result.delta === undefined ? [] : [result.delta],
    );
    const mean = timing.length
      ? timing.reduce((total, value) => total + value, 0) / timing.length
      : null;
    const std =
      mean === null
        ? null
        : Math.sqrt(
            timing.reduce((total, value) => total + (value - mean) ** 2, 0) /
              timing.length,
          );
    const measures = new Map<
      number,
      { miss: number; extra: number; timings: number[] }
    >();
    for (const result of this.results) {
      const index = result.note?.measure ?? 0;
      const value = measures.get(index) ?? { miss: 0, extra: 0, timings: [] };
      if (result.kind === "miss") value.miss += 1;
      if (result.kind === "extra") value.extra += 1;
      if (result.delta !== undefined)
        value.timings.push(Math.abs(result.delta));
      measures.set(index, value);
    }
    return {
      events: this.events,
      summary: {
        total: this.timeline.notes.length,
        perfect: this.count("perfect"),
        good: this.count("good"),
        miss: this.count("miss"),
        extra: this.count("extra"),
        timingMeanMs: this.timeline.spec.mode === "play" ? mean : null,
        timingStdMs: this.timeline.spec.mode === "play" ? std : null,
        perMeasure: [...measures]
          .filter(([measure]) => measure > 0)
          .map(([measure, value]) => ({
            measure,
            miss: value.miss,
            extra: value.extra,
            meanAbsMs: value.timings.length
              ? value.timings.reduce((total, timing) => total + timing, 0) /
                value.timings.length
              : null,
          })),
        aborted,
      },
    };
  }

  private addExtra(): Judgement {
    this.results.push({ kind: "extra" });
    return "extra";
  }
  private count(kind: Judgement): number {
    return this.results.filter((result) => result.kind === kind).length;
  }
}
