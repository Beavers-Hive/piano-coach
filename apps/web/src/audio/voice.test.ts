import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./piano", () => ({ setPianoDuck: vi.fn() }));
import { configureVoice, enqueueVoice, resetVoiceQueueForTest } from "./voice";

describe("voice queue", () => {
  afterEach(() => resetVoiceQueueForTest());
  it("plays clips in seq order and emits done after the final clip", async () => {
    const spoken: string[] = [];
    const done = vi.fn();
    Object.assign(globalThis, {
      SpeechSynthesisUtterance: class {
        lang = "";
        rate = 1;
        text: string;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      },
      speechSynthesis: {
        speak: (utterance: { text: string; onend: (() => void) | null }) => {
          spoken.push(utterance.text);
          queueMicrotask(() => utterance.onend?.());
        },
      },
    });
    configureVoice({ practicing: () => false, level: () => undefined, done });
    enqueueVoice({
      utteranceId: "u",
      seq: 1,
      url: null,
      text: "二",
      last: true,
    });
    enqueueVoice({
      utteranceId: "u",
      seq: 0,
      url: null,
      text: "一",
      last: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spoken).toEqual(["一", "二"]);
    expect(done).toHaveBeenCalledWith("u");
  });
});
