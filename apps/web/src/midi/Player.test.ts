import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTimeline } from "../state/mock";
import { useAppStore } from "../state/store";

const { send, transport } = vi.hoisted(() => ({
  send: vi.fn(),
  transport: {
    cancel: vi.fn(),
    scheduleOnce: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("tone", () => ({ getTransport: () => transport }));
vi.mock("../audio/piano", () => ({ metronome: vi.fn(), playPiano: vi.fn() }));
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
        countInMs: 500,
        spec: { ...mockTimeline.spec, mode: "play" },
      },
      lessonState: "briefing",
      running: false,
      waitingForStart: true,
      handsMode: "hidden",
    });
    send.mockReset();
  });

  afterEach(() => {
    cancelCountIn();
    vi.useRealTimers();
  });

  it("is cancelled before it can start an outdated exercise", () => {
    startPractice();
    cancelCountIn();
    vi.advanceTimersByTime(500);

    expect(send).not.toHaveBeenCalled();
    expect(useAppStore.getState().running).toBe(false);
    expect(useAppStore.getState().waitingForStart).toBe(false);
  });
});
