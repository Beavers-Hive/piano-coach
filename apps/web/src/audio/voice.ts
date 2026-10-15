import { useAppStore } from "../state/store";
import { setPianoDuck } from "./piano";

export type VoiceClip = {
  utteranceId: string;
  seq: number;
  url: string | null;
  text: string;
  last: boolean;
};
type Group = {
  clips: Map<number, VoiceClip>;
  last?: number;
  nextSeq: number;
  playing: boolean;
  /** この発話で、ここまでに字幕に出した文（文を足しながら表示する）。 */
  shown: string;
};
const groups = new Map<string, Group>();
let isPracticing = () => false;
let onLevel: (level: number) => void = () => undefined;
let onDone: (id: string) => void = () => undefined;
let activeAudio: HTMLAudioElement | undefined;
let cancelActive: (() => void) | undefined;
const completed = new Set<string>();
let queueGeneration = 0;
export function configureVoice(options: {
  practicing: () => boolean;
  level: (level: number) => void;
  done: (id: string) => void;
}) {
  isPracticing = options.practicing;
  onLevel = options.level;
  onDone = options.done;
}
// 発話は「届いた順」に 1 つずつ再生する。前の発話が終わるまで、次の発話は始めない
// （以前は発話ごとに独立して再生していたため、講評と次の指示が重なって聞き取れなかった）。
const order: string[] = [];
let pumping = false;
let wake: (() => void) | undefined;
/** 続きの文が届かないまま待ち続けないための上限（サーバー側で取り消された発話など）。 */
const CLIP_WAIT_LIMIT_MS = 12_000;

export function enqueueVoice(clip: VoiceClip) {
  if (completed.has(clip.utteranceId)) return;
  let group = groups.get(clip.utteranceId);
  if (!group) {
    group = {
      clips: new Map<number, VoiceClip>(),
      nextSeq: 0,
      playing: false,
      shown: "",
    };
    groups.set(clip.utteranceId, group);
    order.push(clip.utteranceId);
  }
  if (clip.seq < group.nextSeq || group.clips.has(clip.seq)) return;
  group.clips.set(clip.seq, clip);
  if (clip.last) group.last = clip.seq;
  wake?.();
  void pump(queueGeneration);
}

function waitForClip(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = undefined;
      resolve(false);
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = undefined;
      resolve(true);
    };
  });
}

async function pump(generation: number) {
  if (pumping || generation !== queueGeneration) return;
  pumping = true;
  try {
    while (generation === queueGeneration && order.length && !isPracticing()) {
      const id = order[0];
      const group = groups.get(id);
      if (!group) {
        order.shift();
        continue;
      }
      const clip = group.clips.get(group.nextSeq);
      if (clip) {
        group.playing = true;
        await speak(clip, group);
        group.playing = false;
        if (generation !== queueGeneration) return;
        group.clips.delete(group.nextSeq);
        group.nextSeq += 1;
        if (group.last !== undefined && group.nextSeq > group.last) {
          order.shift();
          groups.delete(id);
          completed.add(id);
          if (completed.size > 256)
            completed.delete(completed.values().next().value!);
          onDone(id);
        }
        continue;
      }
      // この発話の続きの文がまだ届いていない。届くまで待つ（上限を超えたら、この発話は終わったものとする）
      const arrived = await waitForClip(CLIP_WAIT_LIMIT_MS);
      if (generation !== queueGeneration) return;
      if (!arrived && !groups.get(id)?.clips.has(group.nextSeq)) {
        order.shift();
        groups.delete(id);
        onDone(id);
      }
    }
  } finally {
    pumping = false;
    if (generation !== queueGeneration && order.length)
      void pump(queueGeneration);
  }
}

/** 声の長さに対して、字幕を出し終える割合。少し早めに出し終えると、読み上げと自然に揃って見える。 */
const SUBTITLE_FINISH_RATIO = 0.94;
/** 声の長さが分からないとき（ブラウザの代替音声）の、1 文字あたりの読み上げ時間の目安。 */
const MS_PER_CHAR_FALLBACK = 115;

/** 字幕を、この文が声に出る瞬間に出す。タイプの速さは、声の長さに合わせる。 */
const subtitleShown = new WeakSet<VoiceClip>();
function showSubtitle(group: Group, clip: VoiceClip, durationMs: number) {
  // 声の読み込みに失敗して代替音声に切り替わったときに、同じ文を二重に出さない
  if (subtitleShown.has(clip)) return;
  subtitleShown.add(clip);
  group.shown += clip.text;
  const store = useAppStore.getState();
  store.set({
    subtitle: group.shown,
    subtitleDurationMs: Math.max(250, durationMs * SUBTITLE_FINISH_RATIO),
    subtitleSeq: store.subtitleSeq + 1,
  });
}

function speak(clip: VoiceClip, group: Group) {
  const generation = queueGeneration;
  return new Promise<void>((resolve) => {
    let finished = false;
    let usingFallback = false;
    let audio: HTMLAudioElement | undefined;
    let utterance: SpeechSynthesisUtterance | undefined;
    const valid = () => !finished && generation === queueGeneration;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (audio) {
        audio.onplaying = audio.onended = audio.onerror = null;
        audio.pause();
      }
      if (utterance)
        utterance.onstart = utterance.onend = utterance.onerror = null;
      if (activeAudio === audio) activeAudio = undefined;
      if (cancelActive === finish) cancelActive = undefined;
      onLevel(0);
      setPianoDuck(false);
      resolve();
    };
    cancelActive = finish;
    const started = (durationMs: number) => {
      if (!valid()) return;
      setPianoDuck(true);
      onLevel(0.8);
      useAppStore.getState().set({ generation: null });
      showSubtitle(group, clip, durationMs);
    };
    const fallback = () => {
      if (!valid() || usingFallback) return;
      usingFallback = true;
      if (audio) {
        audio.onplaying = audio.onended = audio.onerror = null;
        audio.pause();
      }
      useAppStore.getState().set({ fallbackVoiceAt: performance.now() });
      utterance = new SpeechSynthesisUtterance(clip.text);
      utterance.lang = "ja-JP";
      utterance.rate = 1.2;
      utterance.onstart = () =>
        started(clip.text.length * MS_PER_CHAR_FALLBACK);
      utterance.onend = finish;
      utterance.onerror = finish;
      speechSynthesis.speak(utterance);
    };
    if (clip.url) {
      audio = new Audio(clip.url);
      audio.preload = "auto";
      activeAudio = audio;
      audio.onplaying = () => {
        const seconds = Number.isFinite(audio!.duration) ? audio!.duration : 0;
        started(
          seconds > 0
            ? seconds * 1000
            : clip.text.length * MS_PER_CHAR_FALLBACK,
        );
      };
      audio.onended = finish;
      audio.onerror = fallback;
      void audio.play().catch(fallback);
    } else fallback();
  });
}
/** この発話の声が、再生待ち・再生中か（届いた文がまだ残っているか）。 */
export function isVoicePending(utteranceId: string): boolean {
  return groups.has(utteranceId);
}

export function flushVoice() {
  void pump(queueGeneration);
}

/** 接続断では残った発話を送信せず、現在の音声もただちに止める。 */
export function cancelVoice(): void {
  queueGeneration += 1;
  cancelActive?.();
  groups.clear();
  order.length = 0;
  wake?.();
  activeAudio?.pause();
  activeAudio = undefined;
  if (
    typeof speechSynthesis !== "undefined" &&
    typeof speechSynthesis.cancel === "function"
  ) {
    speechSynthesis.cancel();
  }
  onLevel(0);
  setPianoDuck(false);
}

export function resetVoiceQueueForTest(): void {
  cancelVoice();
  completed.clear();
}
