import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTimeline } from "../state/mock";
import { useAppStore } from "../state/store";

const { send, transport } = vi.hoisted(() => ({
  send: vi.fn(),
  transport: {
    cancel: vi.fn(),
    schedule: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("tone", () => ({
  getTransport: () => transport,
  getDraw: () => ({ schedule: vi.fn() }),
}));
vi.mock("../audio/piano", () => ({
  metronome: vi.fn(),
  playPiano: vi.fn(),
  playGuideNote: vi.fn(),
  outputLatencyMs: () => 0,
}));
vi.mock("../state/ws", () => ({ send }));

import { cancelCountIn, startPractice } from "./Player";

describe("count-in", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    useAppStore.getState().set({
      timeline: {
        ...mockTimeline,
        countInMs: 1800,
        spec: { ...mockTimeline.spec, mode: "play" },
      },
      lessonState: "briefing",
      running: false,
      generation: null,
      waitingForStart: true,
      handsMode: "hidden",
    });
    // Node には画面の更新がないので、何もしないものに置き換える
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    send.mockReset();
    transport.schedule.mockReset();
    transport.stop.mockReset();
  });

  afterEach(() => {
    cancelCountIn();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for generation before accepting a practice start", () => {
    useAppStore.getState().set({ generation: "voice" });
    startPractice();
    expect(transport.schedule).not.toHaveBeenCalled();
    expect(useAppStore.getState().running).toBe(false);
  });

  it("starts a slow exercise after a short count-in with guides aligned", () => {
    const current = useAppStore.getState().timeline!;
    useAppStore.getState().set({
      guideMetronome: true,
      guideNotes: true,
      timeline: { ...current, bpm: 60, beatsPerMeasure: 3, countInMs: 3000 },
    });
    startPractice();
    expect(useAppStore.getState().countInBpm).toBe(100);
    expect(transport.schedule.mock.calls.some((call) => call[1] === 1.8)).toBe(
      true,
    );
    vi.advanceTimersByTime(1829);
    expect(useAppStore.getState().running).toBe(false);
    vi.advanceTimersByTime(1);
    expect(useAppStore.getState().running).toBe(true);
    expect(send).toHaveBeenCalledWith("practice.started", expect.any(Object));
  });

  it("is cancelled before it can start an outdated exercise", () => {
    startPractice();
    cancelCountIn();
    vi.advanceTimersByTime(500);

    expect(send).not.toHaveBeenCalled();
    expect(useAppStore.getState().running).toBe(false);
    expect(useAppStore.getState().waitingForStart).toBe(false);
  });

  it("keeps the metronome and model notes running through a play-mode performance", () => {
    useAppStore.getState().set({ guideMetronome: true, guideNotes: true });
    startPractice();
    const timeline = useAppStore.getState().timeline!;
    // カウントインのクリック + 演奏中のクリック + お手本の音（ノーツ 1 つにつき 1 つ）が予約される
    expect(transport.schedule.mock.calls.length).toBeGreaterThan(
      timeline.beatsPerMeasure + timeline.notes.length,
    );
    transport.stop.mockClear();
    vi.advanceTimersByTime(timeline.countInMs + 40);
    // カウントインが終わっても、目安の音のために Transport を止めない
    expect(transport.stop).not.toHaveBeenCalled();
    expect(useAppStore.getState().running).toBe(true);
  });

  it("schedules only the count-in clicks when both guides are off", () => {
    useAppStore.getState().set({ guideMetronome: false, guideNotes: false });
    startPractice();
    const timeline = useAppStore.getState().timeline!;
    expect(transport.schedule).toHaveBeenCalledTimes(timeline.beatsPerMeasure);
    transport.stop.mockClear();
    vi.advanceTimersByTime(timeline.countInMs + 40);
    expect(transport.stop).toHaveBeenCalled();
  });

  it("does not play guide sounds in wait mode, only the count-in", () => {
    const current = useAppStore.getState().timeline!;
    useAppStore.getState().set({
      guideMetronome: true,
      guideNotes: true,
      timeline: { ...current, spec: { ...current.spec, mode: "wait" } },
    });
    startPractice();
    expect(transport.schedule).toHaveBeenCalledTimes(current.beatsPerMeasure);
  });
});
