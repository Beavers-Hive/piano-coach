import { beforeEach, describe, expect, it } from "vitest";
import { mockTimeline } from "./mock";
import { useAppStore } from "./store";
import { handleIncomingMessage } from "./ws";

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
});
