import { beforeEach, describe, expect, it, vi } from "vitest";
const { enqueueVoice } = vi.hoisted(() => ({ enqueueVoice: vi.fn() }));
// 声の再生は audio/voice.ts が担当する。ここでは、届いたクリップが再生の待ち行列に渡ることだけを確かめる
vi.mock("../audio/voice", () => ({
  enqueueVoice,
  isVoicePending: () => false,
}));

import { mockTimeline } from "./mock";
import { useAppStore } from "./store";
import { handleIncomingMessage, handleSocketClose } from "./ws";

describe("websocket receiver", () => {
  beforeEach(() =>
    useAppStore.getState().set({
      timeline: { ...mockTimeline, exerciseVersion: 2 },
      camera: "overview",
      generation: null,
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

  it("does not show the subtitle until the voice for it starts", () => {
    useAppStore.getState().set({ subtitle: "演奏中" });
    handleIncomingMessage({
      type: "agent.say",
      payload: { utteranceId: "u1", delta: "いいね！", final: false },
    });
    // 字幕は声の再生に合わせて出す。言葉が届いただけでは、字幕は変わらない
    expect(useAppStore.getState().subtitle).toBe("演奏中");
  });

  it("keeps waiting without showing subtitles before audio starts", () => {
    vi.useFakeTimers();
    try {
      useAppStore.getState().set({ subtitle: "", subtitleSeq: 0 });
      handleIncomingMessage({
        type: "agent.say",
        payload: {
          utteranceId: "no-voice",
          delta: "声なしの文。",
          final: true,
        },
      });
      expect(useAppStore.getState().subtitle).toBe("");
      vi.advanceTimersByTime(12_001);
      expect(useAppStore.getState().subtitle).toBe("");
      expect(useAppStore.getState().subtitleSeq).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show the subtitle alone when the voice did arrive", () => {
    vi.useFakeTimers();
    try {
      enqueueVoice.mockClear();
      useAppStore.getState().set({ subtitle: "", subtitleSeq: 0 });
      handleIncomingMessage({
        type: "agent.say",
        payload: {
          utteranceId: "with-voice",
          delta: "声ありの文。",
          final: true,
        },
      });
      const clip = {
        utteranceId: "with-voice",
        seq: 0,
        url: null,
        text: "声ありの文。",
        last: true,
      };
      handleIncomingMessage({ type: "voice.clip", payload: clip });
      expect(enqueueVoice).toHaveBeenCalledWith(clip);
      vi.advanceTimersByTime(12_001);
      // 字幕は声の再生に合わせて出る。声が届いた発話では、字幕だけを重ねて出さない
      expect(useAppStore.getState().subtitle).toBe("");
      expect(useAppStore.getState().subtitleSeq).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

describe("generation feedback", () => {
  it("switches from thinking to preparing voice, and clears on the final clip", () => {
    useAppStore.getState().set({ generation: null });
    handleIncomingMessage({
      type: "lesson.state",
      payload: { state: "reviewing" },
    });
    expect(useAppStore.getState().generation).toBe("thinking");
    handleIncomingMessage({
      type: "agent.say",
      payload: { utteranceId: "loading-test", delta: "いいね！", final: true },
    });
    expect(useAppStore.getState().generation).toBe("voice");
    handleIncomingMessage({
      type: "voice.clip",
      payload: {
        utteranceId: "loading-test",
        seq: 0,
        url: null,
        text: "いいね！",
        last: true,
      },
    });
    expect(useAppStore.getState().generation).toBeNull();
  });

  it("does not keep animating while waiting for an answer or after errors", () => {
    useAppStore.getState().set({ generation: "thinking" });
    handleIncomingMessage({
      type: "agent.ask",
      payload: {
        questionId: "q",
        text: "経験は？",
        options: [],
        allowFree: true,
      },
    });
    expect(useAppStore.getState().generation).toBeNull();
    useAppStore.getState().set({ generation: "voice" });
    handleIncomingMessage({
      type: "error",
      payload: { message: "音声を生成できません" },
    });
    expect(useAppStore.getState().generation).toBeNull();
    useAppStore.getState().set({ generation: "thinking" });
    handleSocketClose();
    expect(useAppStore.getState().generation).toBeNull();
  });
});
