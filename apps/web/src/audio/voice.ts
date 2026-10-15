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
};
const groups = new Map<string, Group>();
let isPracticing = () => false;
let onLevel: (level: number) => void = () => undefined;
let onDone: (id: string) => void = () => undefined;
let activeAudio: HTMLAudioElement | undefined;
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
  let group = groups.get(clip.utteranceId);
  if (!group) {
    group = { clips: new Map<number, VoiceClip>(), nextSeq: 0, playing: false };
    groups.set(clip.utteranceId, group);
    order.push(clip.utteranceId);
  }
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
        await speak(clip);
        group.playing = false;
        if (generation !== queueGeneration) return;
        group.clips.delete(group.nextSeq);
        group.nextSeq += 1;
        if (group.last !== undefined && group.nextSeq > group.last) {
          order.shift();
          groups.delete(id);
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
  }
}

function speak(clip: VoiceClip) {
  return new Promise<void>((resolve) => {
    setPianoDuck(true);
    onLevel(0.8);
    const finish = () => {
      onLevel(0);
      setPianoDuck(false);
      resolve();
    };
    if (clip.url) {
      const audio = new Audio(clip.url);
      activeAudio = audio;
      audio.onended = finish;
      audio.onerror = () => fallback(clip.text, finish);
      void audio.play().catch(() => fallback(clip.text, finish));
    } else fallback(clip.text, finish);
  });
}
function fallback(text: string, done: () => void) {
  useAppStore.getState().set({ fallbackVoiceAt: performance.now() });
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 1.03;
  utterance.onend = done;
  utterance.onerror = done;
  speechSynthesis.speak(utterance);
}
export function flushVoice() {
  void pump(queueGeneration);
}

/** 接続断では残った発話を送信せず、現在の音声もただちに止める。 */
export function cancelVoice(): void {
  queueGeneration += 1;
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
}
