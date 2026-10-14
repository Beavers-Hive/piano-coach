import { describe, expect, it } from "vitest";
import { keyTouchPoint } from "../scene/keyboardLayout";
import { computeHandPose, detectCrossings } from "./pose";
import type { ExerciseTimeline, TimelineNote } from "../types";

function note(
  id: string,
  pitch: number,
  startMs: number,
  finger: 1 | 2 | 3 | 4 | 5,
  hand: "right" | "left" = "right",
  durationMs = 300,
): TimelineNote {
  return {
    playId: `${id}#0`,
    sourceNoteId: id,
    measure: 1,
    loopIndex: 0,
    pitch,
    startMs,
    durationMs,
    hand,
    finger,
  };
}
function timeline(
  notes: TimelineNote[],
  events: ExerciseTimeline["fingeringEvents"] = [],
): ExerciseTimeline {
  return {
    exerciseId: "test",
    exerciseVersion: 1,
    spec: {
      measures: [1, 1],
      hand: "both",
      tempoPercent: 100,
      mode: "watch",
      loop: 1,
      metronome: false,
    },
    bpm: 100,
    beatsPerMeasure: 4,
    countInMs: 2400,
    notes,
    fingeringEvents: events,
  };
}
function distance(
  a: { x: number; y: number; z: number },
  b: readonly number[],
): number {
  return Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]);
}

describe("computeHandPose", () => {
  it("puts the striking fingertip precisely on the key surface", () => {
    const score = timeline([note("R-1", 60, 1000, 1)]);
    const pose = computeHandPose(score, {}, "right", 1000);
    expect(distance(pose.fingers[0].tip, keyTouchPoint(60))).toBeLessThan(
      0.00001,
    );
  });

  it("is pure at a fixed playhead", () => {
    const score = timeline([note("R-1", 60, 800, 2), note("R-2", 64, 1300, 3)]);
    expect(computeHandPose(score, {}, "right", 1120)).toEqual(
      computeHandPose(score, {}, "right", 1120),
    );
  });

  it("detects an ascending right-hand thumb-under", () => {
    const score = timeline([
      note("R-1", 60, 0, 1),
      note("R-2", 62, 300, 2),
      note("R-3", 64, 600, 3),
      note("R-4", 65, 900, 1),
    ]);
    expect(detectCrossings(score, {}, "right").get("R-4")).toBe("thumb_under");
  });

  it("reaches every key in a chord with its assigned finger", () => {
    const score = timeline([
      note("R-1", 60, 1000, 1),
      note("R-2", 64, 1000, 3),
      note("R-3", 67, 1000, 5),
    ]);
    const pose = computeHandPose(score, {}, "right", 1000);
    for (const [finger, pitch] of [
      [1, 60],
      [3, 64],
      [5, 67],
    ] as const) {
      expect(
        distance(pose.fingers[finger - 1].tip, keyTouchPoint(pitch)),
      ).toBeLessThan(0.00001);
    }
  });

  it("moves the wrist continuously through a position shift", () => {
    const score = timeline([note("R-1", 60, 0, 1), note("R-2", 72, 1000, 1)]);
    let previous = computeHandPose(score, {}, "right", 200).wrist.position;
    for (let t = 216; t <= 1000; t += 16) {
      const current = computeHandPose(score, {}, "right", t).wrist.position;
      // At 60fps the wrist travels smoothly (no keyframe teleport), even across an octave shift.
      expect(
        distance(current, [previous.x, previous.y, previous.z]),
      ).toBeLessThan(0.008);
      previous = current;
    }
  });
});
