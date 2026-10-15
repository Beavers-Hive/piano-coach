import { describe, expect, it } from "vitest";
import { mockTimeline } from "../state/mock";
import {
  parseTimemap,
  scoreElementsAt,
  scoreElementsForHit,
  scoreResultClass,
} from "./timemap";

const timemap = parseTimemap([
  { tstamp: 0, on: ["n-1"] },
  { tstamp: 600, on: ["n-2", "n-2-left"] },
  { tstamp: 1200, on: ["n-3"] },
]);

describe("Verovio timemap", () => {
  it("finds the currently sounding score element from a playhead", () => {
    expect(scoreElementsAt(timemap, -1)).toEqual([]);
    expect(scoreElementsAt(timemap, 700)).toEqual(["n-2", "n-2-left"]);
  });

  it("maps a judgement to the closest scheduled score note", () => {
    expect(scoreElementsForHit(mockTimeline, timemap, 67, 610)).toEqual([
      "n-2",
      "n-2-left",
    ]);
    expect(scoreElementsForHit(mockTimeline, timemap, 90, 610)).toEqual([]);
  });

  it("uses only planned-note judgement colours", () => {
    expect(scoreResultClass("perfect")).toBe("score-result-perfect");
    expect(scoreResultClass("good")).toBe("score-result-good");
    expect(scoreResultClass("miss")).toBe("score-result-miss");
    expect(scoreResultClass("extra")).toBeNull();
  });
});
