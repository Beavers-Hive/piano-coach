import { beforeEach, describe, expect, it } from "vitest";
import { mockTimeline } from "./mock";
import { useAppStore } from "./store";
import { handleIncomingMessage, handleSocketClose } from "./ws";

describe("websocket receiver", () => {
  beforeEach(() =>
    useAppStore.getState().set({
      timeline: { ...mockTimeline, exerciseVersion: 2 },
      camera: "overview",
    }),
  );
  it("ignores messages for an old exercise version", () => {
    handleIncomingMessage({
      type: "ui.hint",
      payload: { exerciseVersion: 1, cameraPreset: "closeup" },
    });
    expect(useAppStore.getState().camera).toBe("overview");
    handleIncomingMessage({
      type: "ui.hint",
      payload: { exerciseVersion: 2, cameraPreset: "play" },
    });
    expect(useAppStore.getState().camera).toBe("play");
  });

  it("does not offer practice start while the demonstration is being prepared", () => {
    handleIncomingMessage({
      type: "exercise.ready",
      payload: {
        timeline: {
          ...mockTimeline,
          exerciseVersion: 3,
          spec: { ...mockTimeline.spec, mode: "watch" },
        },
      },
    });
    expect(useAppStore.getState().waitingForStart).toBe(false);
    handleIncomingMessage({
      type: "exercise.ready",
      payload: {
        timeline: {
          ...mockTimeline,
          exerciseVersion: 4,
          spec: { ...mockTimeline.spec, mode: "wait" },
        },
      },
    });
    expect(useAppStore.getState().waitingForStart).toBe(true);
  });

  it("replaces the subtitle when a new utterance starts", () => {
    useAppStore.getState().set({ subtitle: "演奏中" });
    handleIncomingMessage({
      type: "agent.say",
      payload: { utteranceId: "u1", delta: "いいね！", final: false },
    });
    handleIncomingMessage({
      type: "agent.say",
      payload: { utteranceId: "u1", delta: "次へ進もう。", final: true },
    });
    expect(useAppStore.getState().subtitle).toBe("いいね！次へ進もう。");
    handleIncomingMessage({
      type: "agent.say",
      payload: { utteranceId: "u2", delta: "次は右手で。", final: true },
    });
    expect(useAppStore.getState().subtitle).toBe("次は右手で。");
  });

  it("clears active play state and reports a terminal socket disconnect", () => {
    useAppStore.getState().set({
      running: true,
      waitingForStart: true,
      handsMode: "ghost",
      pressed: new Set([60]),
      error: undefined,
    });

    handleSocketClose();

    expect(useAppStore.getState()).toMatchObject({
      running: false,
      waitingForStart: false,
      handsMode: "hidden",
      error: "接続が切れました。ページを再読み込みしてください。",
    });
    expect(useAppStore.getState().pressed.size).toBe(0);
  });
});
