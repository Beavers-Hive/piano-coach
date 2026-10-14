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
});
