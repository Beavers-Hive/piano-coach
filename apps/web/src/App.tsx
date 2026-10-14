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
    if (mock) {
      setSongs(mockSongs);
      set({
        timeline: mockTimeline,
        waitingForStart: true,
        subtitle: "メヌエット ト長調 — 右手を練習しましょう",
        lessonState: "briefing",
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
