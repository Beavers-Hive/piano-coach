import { describe, expect, it } from "vitest";
import { RealtimeJudge } from "./Judge";
import type { ExerciseTimeline } from "../types";

const timeline = (
  mode: "play" | "wait",
  notes = [{ pitch: 60, startMs: 1000 }],
): ExerciseTimeline => ({
  exerciseId: "test",
  exerciseVersion: 1,
  bpm: 100,
  beatsPerMeasure: 3,
  countInMs: 1800,
  spec: {
    measures: [1, 1],
    hand: "right",
    tempoPercent: 100,
    mode,
    loop: 1,
    metronome: false,
  },
  fingeringEvents: [],
  notes: notes.map((note, index) => ({
    playId: `n${index}`,
    sourceNoteId: `n${index}`,
    measure: 1,
    loopIndex: 0,
    pitch: note.pitch,
    startMs: note.startMs,
    durationMs: 300,
    hand: "right",
  })),
});

describe("RealtimeJudge / play", () => {
  it("uses perfect and good timing windows and consumes each planned note once", () => {
    const judge = new RealtimeJudge(
      timeline("play", [
        { pitch: 60, startMs: 1000 },
        { pitch: 60, startMs: 1100 },
      ]),
    );
    expect(judge.onPlayInput("on", 60, 100, 1079)).toBe("perfect");
    expect(judge.onPlayInput("on", 60, 100, 1179)).toBe("perfect");
    expect(judge.onPlayInput("on", 60, 100, 1260)).toBe("extra");
    expect(judge.finish().summary).toMatchObject({ perfect: 2, extra: 1 });
  });
  it("marks expired notes as miss and out-of-window notes as extra", () => {
    const judge = new RealtimeJudge(timeline("play"));
    expect(judge.expire(1161)).toHaveLength(1);
    expect(judge.onPlayInput("on", 60, 100, 1161)).toBe("extra");
    expect(judge.finish().summary).toMatchObject({ miss: 1, extra: 1 });
  });
  it("classifies the 81–160ms range as good", () => {
    const judge = new RealtimeJudge(timeline("play"));
    expect(judge.onPlayInput("on", 60, 100, 1159)).toBe("good");
  });
});

describe("RealtimeJudge / wait", () => {
  it("waits for every note in the next chord", () => {
    const judge = new RealtimeJudge(
      timeline("wait", [
        { pitch: 60, startMs: 0 },
        { pitch: 64, startMs: 0 },
      ]),
    );
    expect(judge.onWaitInput(60, 100, true, 0)).toEqual({
      kind: "perfect",
      chordComplete: false,
    });
    expect(judge.onWaitInput(64, 100, true, 0)).toEqual({
      kind: "perfect",
      chordComplete: true,
    });
  });
  it("does not count a held key twice and requires re-striking repeated pitches", () => {
    const judge = new RealtimeJudge(
      timeline("wait", [
        { pitch: 60, startMs: 0 },
        { pitch: 60, startMs: 500 },
      ]),
    );
    expect(judge.onWaitInput(60, 100, true, 0).chordComplete).toBe(true);
    expect(judge.onWaitInput(60, 100, true, 10)).toEqual({
      chordComplete: false,
    });
    judge.onWaitInput(60, 0, false, 20);
    expect(judge.onWaitInput(60, 100, true, 500).chordComplete).toBe(true);
  });
});
