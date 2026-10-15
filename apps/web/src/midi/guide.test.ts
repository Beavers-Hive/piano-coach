import { describe, expect, it } from "vitest";
import { mockTimeline } from "../state/mock";
import type { ExerciseTimeline } from "../types";
import { buildGuideSchedule, guideIsActive } from "./guide";

function timeline(
  mode: "wait" | "play" | "watch",
  bpm = 100,
): ExerciseTimeline {
  return {
    ...mockTimeline,
    bpm,
    beatsPerMeasure: 3,
    countInMs: (3 * 60_000) / bpm,
    spec: { ...mockTimeline.spec, mode },
  };
}

describe("buildGuideSchedule", () => {
  it("counts in quickly, accenting the first beat", () => {
    const { clicks } = buildGuideSchedule(timeline("play", 100), {
      metronome: false,
      notes: false,
    });
    // 3/4 拍子の3拍を、600ms間隔に短縮する。
    expect(clicks.map((click) => click.atMs)).toEqual([0, 600, 1200]);
    expect(clicks.map((click) => click.accent)).toEqual([true, false, false]);
    expect(clicks.map((click) => click.countInBeat)).toEqual([3, 2, 1]);
  });

  it("caps the count-in interval even for slow exercises", () => {
    const slow = buildGuideSchedule(timeline("play", 60), {
      metronome: false,
      notes: false,
    });
    expect(slow.clicks.map((click) => click.atMs)).toEqual([0, 600, 1200]);
  });

  it("keeps clicking through the performance when the metronome is on", () => {
    const tl = timeline("play", 100);
    const { clicks, countInMs } = buildGuideSchedule(tl, {
      metronome: true,
      notes: false,
    });
    const performance = clicks.filter((click) => click.countInBeat === null);
    expect(performance.length).toBeGreaterThan(0);
    // 演奏の頭（カウントインの直後）から、拍が途切れず続く
    expect(performance[0].atMs).toBeCloseTo(countInMs, 5);
    for (let index = 1; index < performance.length; index += 1) {
      expect(performance[index].atMs - performance[index - 1].atMs).toBeCloseTo(
        600,
        5,
      );
    }
    // 小節の頭ごとにアクセント（3 拍に 1 回）
    expect(performance.map((click) => click.accent).slice(0, 4)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    // 最後の音が終わるまで鳴り、そのあとは続けない
    const end = Math.max(...tl.notes.map((n) => n.startMs + n.durationMs));
    expect(performance.at(-1)!.atMs - countInMs).toBeLessThan(end);
    expect(performance.at(-1)!.atMs - countInMs + 600).toBeGreaterThanOrEqual(
      end,
    );
  });

  it("schedules the model notes after the count-in, one per timeline note", () => {
    const tl = timeline("play", 100);
    const { notes, countInMs } = buildGuideSchedule(tl, {
      metronome: false,
      notes: true,
    });
    expect(notes).toHaveLength(tl.notes.length);
    expect(notes[0].atMs).toBeCloseTo(countInMs + tl.notes[0].startMs, 5);
    expect(notes.map((note) => note.pitch)).toEqual(
      tl.notes.map((note) => note.pitch),
    );
  });

  it("schedules no model notes when they are off", () => {
    const { notes } = buildGuideSchedule(timeline("play"), {
      metronome: true,
      notes: false,
    });
    expect(notes).toEqual([]);
  });
});

describe("guideIsActive", () => {
  it("is on only in play mode, and only when at least one guide is enabled", () => {
    expect(
      guideIsActive(timeline("play"), { metronome: true, notes: true }),
    ).toBe(true);
    expect(
      guideIsActive(timeline("play"), { metronome: false, notes: true }),
    ).toBe(true);
    expect(
      guideIsActive(timeline("play"), { metronome: false, notes: false }),
    ).toBe(false);
    // 待機モードは、正しい鍵盤を待ってくれるので、目安の音は鳴らさない
    expect(
      guideIsActive(timeline("wait"), { metronome: true, notes: true }),
    ).toBe(false);
    expect(
      guideIsActive(timeline("watch"), { metronome: true, notes: true }),
    ).toBe(false);
  });
});
