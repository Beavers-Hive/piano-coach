import { useEffect, useState } from "react";
import { configureVoice, flushVoice } from "./audio/voice";
import {
  handlePracticeNote,
  playDemo,
  startPractice,
  stopPractice,
} from "./midi/Player";
import { initialiseMidi, setMidiDisconnectHandler } from "./midi/MidiInput";
import { setTimeScale } from "./midi/clock";
import { PianoScene } from "./scene/Scene";
import { mockSongs, mockTimeline } from "./state/mock";
import type { ScoreModel } from "./types";
import { useAppStore } from "./state/store";
import { connectSocket, send } from "./state/ws";
import { Hud } from "./ui/Hud";
import { Setup } from "./ui/Setup";

const pcKeys: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
};

declare global {
  interface Window {
    __pianoCoach?: {
      pressKey: (pitch: number, velocity?: number) => void;
      releaseKey: (pitch: number) => void;
      setTimeScale: (scale: number) => void;
      getState: () => ReturnType<typeof useAppStore.getState>;
    };
  }
}

export default function App() {
  const [entered, setEntered] = useState(false);
  const [songs, setSongs] = useState<
    { songId: string; title: string; composer: string }[]
  >([]);
  const mock = new URLSearchParams(location.search).get("mock") === "1";
  const running = useAppStore((state) => state.running);
  const set = useAppStore((state) => state.set);

  useEffect(() => {
    configureVoice({
      practicing: () => useAppStore.getState().running,
      level: (voiceLevel) => useAppStore.getState().set({ voiceLevel }),
      done: (utteranceId) => send("voice.done", { utteranceId }),
    });
  }, []);

  useEffect(() => {
    const input = (
      pitch: number,
      velocity: number,
      on: boolean,
      timestamp: number,
    ) => {
      const state = useAppStore.getState();
      state.press(pitch, on);
      if (on && state.waitingForStart && !state.running) {
        startPractice();
        return;
      }
      handlePracticeNote(pitch, velocity, on, timestamp);
    };
    void initialiseMidi(input);
    setMidiDisconnectHandler(() => stopPractice(true));
    const down = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      const pitch = pcKeys[event.key.toLowerCase()];
      if (pitch === undefined) return;
      event.preventDefault();
      input(pitch, 100, true, performance.now());
    };
    const up = (event: KeyboardEvent) => {
      const pitch = pcKeys[event.key.toLowerCase()];
      if (pitch !== undefined) input(pitch, 0, false, performance.now());
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const demo = () => playDemo();
    addEventListener("piano-demo", demo);
    return () => removeEventListener("piano-demo", demo);
  }, []);

  useEffect(() => {
    if (mock) {
      set({ health: { claude: false, tts: false } });
      return;
    }
    void fetch("/api/health")
      .then((response) => response.json())
      .then((health) => set({ health }))
      .catch(() => set({ health: { claude: false, tts: false } }));
  }, [mock, set]);

  useEffect(() => {
    if (!entered) return;
    if (mock && new URLSearchParams(location.search).get("import") === "1") {
      // 読み込み演出の確認用。importing → analyzing（楽譜が届く）→ 約 8 秒後に課題の説明へ移る
      setSongs(mockSongs);
      return playMockImport(set);
    }
    if (mock) {
      setSongs(mockSongs);
      set({
        timeline: mockTimeline,
        waitingForStart: true,
        subtitle: "メヌエット ト長調 — 右手を練習しましょう",
        lessonState: "briefing",
        camera: "play",
      });
      return;
    }
    connectSocket();
    void fetch("/api/songs")
      .then((response) => response.json())
      .then((data) => setSongs(data.songs ?? []))
      .catch(() =>
        set({
          error: "サーバーに接続できません。?mock=1 なら単独で試せます。",
        }),
      );
  }, [entered, mock, set]);

  useEffect(() => {
    if (!running) flushVoice();
  }, [running]);
  useEffect(() => () => stopPractice(true), []);

  useEffect(() => {
    if (!import.meta.env.DEV && !import.meta.env.MODE.includes("test")) return;
    window.__pianoCoach = {
      pressKey: (pitch, velocity = 100) => {
        const state = useAppStore.getState();
        state.press(pitch, true);
        if (state.waitingForStart && !state.running) startPractice();
        else handlePracticeNote(pitch, velocity, true, performance.now());
      },
      releaseKey: (pitch) =>
        handlePracticeNote(pitch, 0, false, performance.now()),
      setTimeScale,
      getState: useAppStore.getState,
    };
    return () => {
      delete window.__pianoCoach;
    };
  }, []);

  const chooseSong = (songId: string) => {
    if (mock) {
      set({
        timeline: { ...mockTimeline, exerciseId: songId },
        waitingForStart: true,
      });
      return;
    }
    send("lesson.start", { songId });
  };
  return entered ? (
    <div className="app">
      <PianoScene />
      <Hud songs={songs} onSong={chooseSong} />
    </div>
  ) : (
    <Setup onBegin={() => setEntered(true)} />
  );
}

/** ?mock=1&import=1 のときだけ、楽譜の読み込みから課題の説明までを約 8 秒で再現する。 */
function playMockImport(set: (patch: Partial<AppStateLike>) => void) {
  type Patch = Partial<AppStateLike>;
  const timers: number[] = [];
  const at = (ms: number, patch: Patch) =>
    timers.push(window.setTimeout(() => set(patch), ms));
  set({
    lessonState: "importing",
    camera: "score",
    // 1 ページ分の PNG を 3 枚並べる（扇状に重なる様子の確認用）
    pageImageUrls: Array(3).fill("/mock/page-1.png"),
    importProgress: { stage: "reading", ratio: 0.1 },
  });
  at(900, {
    lessonState: "analyzing",
    importProgress: { stage: "analyzing", ratio: 0.3 },
  });
  at(2200, { importProgress: { stage: "analyzing", ratio: 0.55 } });
  at(2800, { score: mockScore() });
  at(4200, { importProgress: { stage: "analyzing", ratio: 0.8 } });
  at(5600, {
    importProgress: { stage: "fingering", ratio: 1 },
    lessonState: "hearing",
  });
  at(8000, {
    timeline: mockTimeline,
    waitingForStart: true,
    subtitle: "メヌエット ト長調 — 右手を練習しましょう",
    lessonState: "briefing",
    camera: "play",
  });
  return () => timers.forEach((timer) => window.clearTimeout(timer));
}

type AppStateLike = ReturnType<typeof useAppStore.getState>;

/** モック用の ScoreModel（メヌエットの冒頭。右手は mockTimeline と同じ、左手は二分音符）。 */
function mockScore(): ScoreModel {
  const left = [55, 59, 62, 57, 60, 64];
  return {
    songId: "minuet-g",
    title: "メヌエット ト長調",
    composer: "J. S. Bach",
    ppq: 480,
    timeSignature: { num: 3, den: 4 },
    bpm: 100,
    keyFifths: 1,
    measures: Array.from({ length: 4 }, (_, index) => ({
      index: index + 1,
      startTick: index * 1440,
      endTick: (index + 1) * 1440,
    })),
    notes: [
      ...mockTimeline.notes.map((note, index) => ({
        id: note.sourceNoteId,
        pitch: note.pitch,
        startTick: index * 360,
        durationTick: 330,
        hand: "right" as const,
        measure: Math.floor(index / 4) + 1,
        beat: (index % 4) + 1,
      })),
      ...left.map((pitch, index) => ({
        id: `L-${index}`,
        pitch,
        startTick: index * 720,
        durationTick: 690,
        hand: "left" as const,
        measure: Math.floor(index / 2) + 1,
        beat: 1,
      })),
    ],
  };
}
