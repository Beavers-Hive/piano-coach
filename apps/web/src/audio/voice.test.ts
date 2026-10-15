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
        speak: (utterance: {
          text: string;
          onstart?: () => void;
          onend: (() => void) | null;
        }) => {
          utterance.onstart?.();
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
        speak: (utterance: {
          text: string;
          onstart?: () => void;
          onend: (() => void) | null;
        }) => {
          utterance.onstart?.();
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

describe("subtitle follows the voice", () => {
  afterEach(() => resetVoiceQueueForTest());
  it("shows each sentence when its voice starts, accumulating within an utterance and sized to the voice", async () => {
    const { useAppStore } = await import("../state/store");
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
        speak: (utterance: {
          onstart?: () => void;
          onend: (() => void) | null;
        }) => {
          utterance.onstart?.();
          pending.push(() => utterance.onend?.());
        },
      },
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    useAppStore.getState().set({ subtitle: "前の字幕", subtitleSeq: 0 });
    configureVoice({
      practicing: () => false,
      level: () => undefined,
      done: () => undefined,
    });
    enqueueVoice({
      utteranceId: "A",
      seq: 0,
      url: null,
      text: "いいね。",
      last: false,
    });
    enqueueVoice({
      utteranceId: "A",
      seq: 1,
      url: null,
      text: "次へ行こう。",
      last: true,
    });
    await tick();
    // 1 文目の声が始まった時点で、1 文目だけが字幕に出る（2 文目はまだ）
    expect(useAppStore.getState().subtitle).toBe("いいね。");
    expect(useAppStore.getState().subtitleDurationMs).toBeGreaterThan(250);
    const firstSeq = useAppStore.getState().subtitleSeq;
    pending.shift()!();
    await tick();
    // 1 文目が終わって、2 文目の声が始まると、同じ発話の字幕に文が足される
    expect(useAppStore.getState().subtitle).toBe("いいね。次へ行こう。");
    expect(useAppStore.getState().subtitleSeq).toBeGreaterThan(firstSeq);
    pending.shift()!();
    await tick();
  });
});

describe("audio start and duplicate protection", () => {
  afterEach(() => resetVoiceQueueForTest());
  it("shows subtitles on playing and ignores a repeated completed clip", async () => {
    const { useAppStore } = await import("../state/store");
    const audios: any[] = [];
    class AudioStub {
      duration = 2;
      preload = "";
      onplaying: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        audios.push(this);
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    Object.assign(globalThis, { Audio: AudioStub });
    const done = vi.fn();
    configureVoice({ practicing: () => false, level: () => undefined, done });
    useAppStore.getState().set({ subtitle: "前の字幕" });
    const clip = {
      utteranceId: "actual-start",
      seq: 0,
      url: "/voice.wav",
      text: "一度だけ",
      last: true,
    };
    enqueueVoice(clip);
    await Promise.resolve();
    expect(useAppStore.getState().subtitle).toBe("前の字幕");
    audios[0].onplaying();
    expect(useAppStore.getState().subtitle).toBe("一度だけ");
    audios[0].onended();
    await new Promise((resolve) => setTimeout(resolve, 0));
    enqueueVoice({ ...clip });
    expect(audios).toHaveLength(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("starts fallback once when both audio error and play rejection occur", async () => {
    const { useAppStore } = await import("../state/store");
    let audio: any;
    const utterances: any[] = [];
    Object.assign(globalThis, {
      Audio: class {
        onerror: (() => void) | null = null;
        constructor() {
          audio = this;
        }
        play() {
          return Promise.reject(new Error("unavailable"));
        }
        pause() {}
      },
      SpeechSynthesisUtterance: class {
        constructor(public text: string) {}
      },
      speechSynthesis: {
        speak: (u: any) => utterances.push(u),
        cancel: () => undefined,
      },
    });
    configureVoice({
      practicing: () => false,
      level: () => undefined,
      done: () => undefined,
    });
    useAppStore.getState().set({ subtitle: "前の字幕" });
    enqueueVoice({
      utteranceId: "failure-race",
      seq: 0,
      url: "/bad.wav",
      text: "代替の声",
      last: true,
    });
    audio.onerror();
    await Promise.resolve();
    expect(utterances).toHaveLength(1);
    expect(useAppStore.getState().subtitle).toBe("前の字幕");
    utterances[0].onstart();
    expect(useAppStore.getState().subtitle).toBe("代替の声");
    utterances[0].onend();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
