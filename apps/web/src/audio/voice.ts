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
export function configureVoice(options: {
  practicing: () => boolean;
  level: (level: number) => void;
  done: (id: string) => void;
}) {
  isPracticing = options.practicing;
  onLevel = options.level;
  onDone = options.done;
}
export function enqueueVoice(clip: VoiceClip) {
  const group: Group = groups.get(clip.utteranceId) ?? {
    clips: new Map<number, VoiceClip>(),
    nextSeq: 0,
    playing: false,
  };
  group.clips.set(clip.seq, clip);
  if (clip.last) group.last = clip.seq;
  groups.set(clip.utteranceId, group);
  void drain(clip.utteranceId, group);
}
async function drain(id: string, group: Group) {
  if (group.playing || isPracticing()) return;
  group.playing = true;
  while (group.clips.has(group.nextSeq) && !isPracticing()) {
    const clip = group.clips.get(group.nextSeq)!;
    await speak(clip);
    group.clips.delete(group.nextSeq);
    group.nextSeq += 1;
  }
  group.playing = false;
  if (group.last !== undefined && group.nextSeq > group.last) {
    groups.delete(id);
    onDone(id);
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
  for (const [id, group] of groups) void drain(id, group);
}

export function resetVoiceQueueForTest(): void {
  groups.clear();
}
