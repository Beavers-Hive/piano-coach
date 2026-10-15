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

  it("never overlaps two utterances: the next one waits for the previous one to finish", async () => {
    const events: string[] = [];
    const pending: Array<() => void> = [];
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
          events.push(`start:${utterance.text}`);
          // 再生は手動で終わらせる（重なりを検出するため）
          pending.push(() => {
            events.push(`end:${utterance.text}`);
            utterance.onend?.();
          });
        },
      },
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    configureVoice({
      practicing: () => false,
      level: () => undefined,
      done: () => undefined,
    });
    // 講評（A）の 1 文目、次の指示（B）の 1 文目、講評（A）の 2 文目の順に届く
    enqueueVoice({
      utteranceId: "A",
      seq: 0,
      url: null,
      text: "A1",
      last: false,
    });
    await tick();
    enqueueVoice({
      utteranceId: "B",
      seq: 0,
      url: null,
      text: "B1",
      last: true,
    });
    enqueueVoice({
      utteranceId: "A",
      seq: 1,
      url: null,
      text: "A2",
      last: true,
    });
    await tick();
    expect(events).toEqual(["start:A1"]);
    pending.shift()!();
    await tick();
    pending.shift()!();
    await tick();
    pending.shift()!();
    await tick();
    expect(events).toEqual([
      "start:A1",
      "end:A1",
      "start:A2",
      "end:A2",
      "start:B1",
      "end:B1",
    ]);
  });
});
