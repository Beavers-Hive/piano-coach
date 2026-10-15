import { useCallback, useEffect, useRef, useState } from "react";
import { cancelVoice, configureVoice, flushVoice } from "./audio/voice";
import {
  abortPlayback,
  cancelCountIn,
  handlePracticeNote,
  playDemo,
  startPractice,
  stopPractice,
} from "./midi/Player";
import { initialiseMidi, setMidiDisconnectHandler } from "./midi/MidiInput";
import { setTimeScale } from "./midi/clock";
import { PianoScene } from "./scene/Scene";
import { mockSavedProgress, mockSongs, mockTimeline } from "./state/mock";
import type { ScoreModel, SongEntry } from "./types";
import { useAppStore } from "./state/store";
import { connectSocket, send } from "./state/ws";
import { isFullscreenShortcut, toggleFullscreen } from "./ui/fullscreen";
import { Hud } from "./ui/Hud";
import { setResumeNext } from "./ui/introState";
import { ResumePrompt } from "./ui/ResumePrompt";
import {
  closeResumePrompt,
  newestResumable,
  resumeTargetOf,
  showResumePrompt,
} from "./ui/resumeState";
import { Setup } from "./ui/Setup";
import { Toasts } from "./ui/Toasts";
import { ScorePanel } from "./ui/ScorePanel";

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
  const [songs, setSongs] = useState<SongEntry[]>([]);
  // 最新の曲一覧（曲を選んだときの判定用。保存済みの進捗はレッスン中に変わる）
  const songsRef = useRef<SongEntry[]>([]);
  songsRef.current = songs;
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
    setMidiDisconnectHandler(() => {
      cancelCountIn();
      stopPractice(true);
    });
    // PC キーボードで鍵盤を弾く。Cmd/Ctrl/Alt を押しているときは弾かない
    // （以前は F キーを握りつぶしていて、Cmd+Shift+F などのショートカットがブラウザに届かなかった）。
    const heldPcKeys = new Set<string>();
    const down = (event: KeyboardEvent) => {
      if (isFullscreenShortcut(event)) {
        event.preventDefault();
        if (!event.repeat) void toggleFullscreen();
        return;
      }
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const key = event.key.toLowerCase();
      const pitch = pcKeys[key];
      if (pitch === undefined) return;
      event.preventDefault();
      heldPcKeys.add(key);
      input(pitch, 100, true, performance.now());
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const pitch = pcKeys[key];
      // 弾いた鍵だけを離す（修飾キー付きで無視した押下の離しを、音の終わりとして扱わない）
      if (pitch !== undefined && heldPcKeys.delete(key))
        input(pitch, 0, false, performance.now());
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      setMidiDisconnectHandler(() => undefined);
    };
  }, []);

  useEffect(() => {
    const demo = () => playDemo();
    addEventListener("piano-demo", demo);
    return () => removeEventListener("piano-demo", demo);
  }, []);

  useEffect(() => {
    const disconnected = () => {
      abortPlayback();
      cancelVoice();
    };
    addEventListener("piano-ws-disconnected", disconnected);
    addEventListener("piano-exercise-changed", abortPlayback);
    return () => {
      removeEventListener("piano-ws-disconnected", disconnected);
      removeEventListener("piano-exercise-changed", abortPlayback);
    };
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
    if (mock && new URLSearchParams(location.search).has("demo")) {
      // ?mock=1&demo=1: サーバーがお手本を始めたときと同じ状態（lessonState=demo、mode=watch）を再現する。
      // 見た目の撮影テストで、ホログラムの手の表示を検査するために使う。
      setSongs(mockSongs);
      set({
        timeline: {
          ...mockTimeline,
          spec: { ...mockTimeline.spec, mode: "watch" },
        },
        waitingForStart: false,
        subtitle: "お手本を見てみよう",
        lessonState: "demo",
        camera: "play",
      });
      const timer = window.setTimeout(
        () => dispatchEvent(new CustomEvent("piano-demo")),
        800,
      );
      return () => clearTimeout(timer);
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
      return playMockUi(new URLSearchParams(location.search).get("ui"), set, {
        setSongs,
      });
    }
    connectSocket();
    // 開発時の StrictMode は effect を 2 回走らせる。1 回目の結果は捨てる（カードが二重に出ないように）
    let cancelled = false;
    void fetchSongs()
      .then((list) => {
        if (cancelled) return;
        setSongs(list);
        // 準備画面を終えた直後。レッスンがまだ始まっていなければ、いちばん新しい続きを尋ねる
        const target = newestResumable(list);
        if (target && useAppStore.getState().lessonState === "idle")
          showResumePrompt(target);
      })
      .catch(() => {
        if (!cancelled)
          set({
            error: "サーバーに接続できません。?mock=1 なら単独で試せます。",
          });
      });
    return () => {
      cancelled = true;
    };
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

  const startLesson = useCallback(
    (songId: string, resume: boolean) => {
      setResumeNext(resume);
      if (mock) {
        set({
          timeline: { ...mockTimeline, exerciseId: songId },
          waitingForStart: true,
          ...(resume ? { score: mockScore() } : {}),
        });
        return;
      }
      send("lesson.start", resume ? { songId, resume: true } : { songId });
    },
    [mock, set],
  );
  // 曲を選んだ（または PDF を渡した）とき。保存済みの進捗があれば、先に続きから始めるかを尋ねる
  const chooseSong = useCallback(
    async (songId: string) => {
      let list = songsRef.current;
      if (!mock) {
        // 保存済みの進捗は、レッスン中や PDF の取り込みで変わるので、一覧を取り直して確認する
        try {
          list = await fetchSongs();
          setSongs(list);
        } catch {
          // 取れなければ、手元の一覧で判断する
        }
      }
      const target = resumeTargetOf(
        list.find((song) => song.songId === songId),
      );
      if (target) showResumePrompt(target);
      else startLesson(songId, false);
    },
    [mock, startLesson],
  );
  const answerResume = (songId: string, resume: boolean) => {
    closeResumePrompt();
    startLesson(songId, resume);
  };
  return (
    <>
      {entered ? (
        <div className="app">
          <PianoScene />
          <ScorePanel />
          <Hud songs={songs} onSong={(id) => void chooseSong(id)} />
          <ResumePrompt onChoose={answerResume} />
        </div>
      ) : (
        <Setup onBegin={() => setEntered(true)} />
      )}
      <Toasts />
    </>
  );
}

async function fetchSongs(): Promise<SongEntry[]> {
  const response = await fetch("/api/songs");
  const data = (await response.json()) as { songs?: SongEntry[] };
  // サーバーが progress を返さない古い版でも動くよう、欠けていれば null にそろえる
  return (data.songs ?? []).map((song) => ({
    ...song,
    progress: song.progress ?? null,
  }));
}

/**
 * ?mock=1&ui=… で、画面ごとの状態を再現する（見た目の撮影と確認用）。カンマで組み合わせられる。
 * dialogue / question / plan / result / countin / drill / playing / error / title / resume
 */
function playMockUi(
  ui: string | null,
  set: (patch: Partial<AppStateLike>) => void,
  hooks: { setSongs: (songs: SongEntry[]) => void },
) {
  if (!ui) return;
  const timers: number[] = [];
  const intervals: number[] = [];
  const at = (ms: number, fn: () => void) =>
    timers.push(window.setTimeout(fn, ms));
  const kinds = ui.split(",");
  const plan = {
    goal: "メヌエットの右手を、なめらかに弾けるようになる",
    currentStepId: "s3",
    steps: [
      {
        id: "s1",
        title: "5 本指のウォームアップ",
        description: "ドからソまでを、ゆっくり均等に。",
        status: "done" as const,
      },
      {
        id: "s2",
        title: "1〜4 小節をお手本どおりに",
        description: "運指を確かめながら、まず目で追います。",
        status: "done" as const,
      },
      {
        id: "s3",
        title: "右手だけで通して弾く",
        description: "ゆっくりのテンポで、止まらずに最後まで。",
        status: "doing" as const,
      },
      {
        id: "s4",
        title: "テンポを 80% に上げる",
        description: "",
        status: "todo" as const,
      },
      {
        id: "s5",
        title: "左手を合わせる",
        description: "",
        status: "todo" as const,
      },
    ],
  };
  for (const kind of kinds) {
    switch (kind) {
      case "dialogue":
        set({
          subtitle:
            "メヌエット ト長調は、バッハの家で長く愛されてきた小品です。まずは右手のメロディーを、運指どおりに弾いてみましょう。",
        });
        break;
      case "question":
        set({
          timeline: null,
          lessonState: "hearing",
          waitingForStart: false,
          camera: "overview",
          subtitle: "",
          question: {
            questionId: "q1",
            text: "ピアノの経験はどれくらいありますか？",
            options: ["はじめて", "少し弾ける", "ふだんから弾く"],
            allowFree: true,
          },
        });
        break;
      case "plan":
        set({ plan });
        break;
      case "resume": {
        // 準備画面を終えた直後に「前回の続きから」を尋ねる状態（保存済みの進捗がある曲が 1 つ）
        const songs = mockSongs.map((song) => ({
          ...song,
          progress: mockSavedProgress(),
        }));
        hooks.setSongs(songs);
        set({
          timeline: null,
          lessonState: "idle",
          waitingForStart: false,
          camera: "overview",
          subtitle: "",
        });
        const target = newestResumable(songs);
        if (target) at(400, () => showResumePrompt(target));
        break;
      }
      case "title":
        // 曲の導入（タイトルカードと、幕が上がる照明）の確認用
        set({
          timeline: null,
          waitingForStart: false,
          lessonState: "hearing",
          camera: "overview",
          subtitle: "",
        });
        at(300, () => set({ score: mockScore() }));
        break;
      case "result":
        set({ waitingForStart: false });
        at(300, () =>
          set({
            lastResult: {
              at: Date.now(),
              summary: {
                total: 16,
                perfect: 14,
                good: 2,
                miss: 0,
                extra: 1,
                timingMeanMs: 12,
                timingStdMs: 30,
                perMeasure: [],
                aborted: false,
              },
            },
          }),
        );
        // 成績の違いも確認できるよう、?ui=result,low で低めの結果にする
        if (kinds.includes("low"))
          at(300, () =>
            set({
              lastResult: {
                at: Date.now(),
                summary: {
                  total: 16,
                  perfect: 8,
                  good: 4,
                  miss: 4,
                  extra: 2,
                  timingMeanMs: 40,
                  timingStdMs: 60,
                  perMeasure: [],
                  aborted: false,
                },
              },
            }),
          );
        break;
      case "countin": {
        set({ waitingForStart: false, countInBpm: 100, subtitle: "" });
        let beat = 3;
        const tick = () => {
          set({ countInBeat: beat });
          beat = beat === 1 ? 3 : beat - 1;
        };
        tick();
        intervals.push(window.setInterval(tick, 600));
        break;
      }
      case "drill":
        set({
          timeline: {
            ...mockTimeline,
            exerciseId: "drill-five-finger",
            spec: {
              ...mockTimeline.spec,
              focus: "5 本指の基礎",
              drill: { kind: "five_finger", startPitch: 60, key: "C", bars: 2 },
            },
          },
          subtitle:
            "まずは指ならし。ドから順に、5 本の指で上って下りましょう。",
        });
        break;
      case "playing":
        // 演奏中の見た目（状態表示、コンボ、手）
        set({
          waitingForStart: false,
          running: true,
          lessonState: "practicing",
          handsMode: "ghost",
          subtitle: "演奏中",
          combo: 12,
        });
        break;
      case "error":
        set({
          error:
            "MIDI の権限が許可されていません。ブラウザの設定を確認するか、PC キーボードで続けてください。",
        });
        break;
      default:
        break;
    }
  }
  return () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    intervals.forEach((timer) => window.clearInterval(timer));
  };
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
