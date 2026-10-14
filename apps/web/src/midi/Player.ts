import * as Tone from "tone";
import { metronome, playPiano } from "../audio/piano";
import { useAppStore } from "../state/store";
import { send } from "../state/ws";
import type { ExerciseTimeline, TimelineNote } from "../types";
import {
  getPlayheadMs,
  pauseClock,
  setTimeScale,
  startClock,
  stopClock,
} from "./clock";
import { RealtimeJudge } from "./Judge";

let judge: RealtimeJudge | null = null;
let frame = 0;
let finishTimer = 0;
let countInTimer = 0;
let activeTimeline: ExerciseTimeline | null = null;
let demoTriggered = new Set<string>();
let slowedEventId: string | null = null;

function currentTimeline(): ExerciseTimeline | null {
  return useAppStore.getState().timeline;
}

function loop(): void {
  const timeline = activeTimeline;
  const state = useAppStore.getState();
  if (!timeline || !state.running) return;
  const playhead = getPlayheadMs();

  if (timeline.spec.mode === "play" && judge) {
    for (const missed of judge.expire(playhead))
      state.recordHit(missed.pitch, "miss");
  }
  if (state.lessonState === "demo") playDemoNotes(timeline, playhead);
  frame = requestAnimationFrame(loop);
}

export function startPractice(): void {
  const timeline = currentTimeline();
  if (!timeline || useAppStore.getState().running) return;
  // お手本用（watch）の課題は演奏できない。次の課題が届くまで待つ
  if (timeline.spec.mode === "watch") return;
  countIn(timeline);
}

function countIn(timeline: ExerciseTimeline): void {
  cancelCountIn();
  activeTimeline = timeline;
  const state = useAppStore.getState();
  state.set({
    waitingForStart: false,
    subtitle: "ワン、ツー、スリー…",
    handsMode: "hidden",
  });
  const transport = Tone.getTransport();
  const beatSeconds = 60 / timeline.bpm;
  transport.stop();
  transport.cancel(0);
  for (let beat = 0; beat < timeline.beatsPerMeasure; beat += 1) {
    transport.scheduleOnce((time) => metronome(time), beat * beatSeconds);
  }
  startClock(-timeline.countInMs);
  transport.start("+0.03");

  countInTimer = window.setTimeout(() => {
    const current = currentTimeline();
    if (
      current?.exerciseId !== timeline.exerciseId ||
      current.exerciseVersion !== timeline.exerciseVersion
    ) {
      cancelCountIn();
      return;
    }
    countInTimer = 0;
    transport.stop();
    transport.cancel(0);
    startClock(0);
    judge = new RealtimeJudge(timeline);
    const wait = timeline.spec.mode === "wait";
    if (wait) pauseClock();
    useAppStore.getState().set({
      running: true,
      lessonState: "practicing",
      handsMode: "ghost",
      subtitle: wait ? "次の音をひいてください" : "演奏中",
    });
    send("practice.started", {
      exerciseId: timeline.exerciseId,
      exerciseVersion: timeline.exerciseVersion,
    });
    frame = requestAnimationFrame(loop);

    if (!wait) {
      const finalMs =
        lastEnd(timeline) + (60_000 / timeline.bpm) * timeline.beatsPerMeasure;
      finishTimer = window.setTimeout(() => stopPractice(false), finalMs);
    }
  }, timeline.countInMs);
}

export function handlePracticeNote(
  pitch: number,
  velocity: number,
  on: boolean,
  _timestamp: number,
): void {
  const state = useAppStore.getState();
  state.press(pitch, on);
  const timeline = activeTimeline;
  if (!timeline || !state.running || !judge) return;
  const playhead = getPlayheadMs();

  if (timeline.spec.mode === "wait") {
    const response = judge.onWaitInput(pitch, velocity, on, playhead);
    if (response.kind) state.recordHit(pitch, response.kind);
    if (response.chordComplete) {
      const next = judge.nextStartMs();
      if (next === null) {
        finishTimer = window.setTimeout(() => stopPractice(false), 350);
      } else {
        startClock(next);
        pauseClock();
        state.set({ subtitle: "いい調子。次の音へ" });
      }
    }
    return;
  }

  const result = judge.onPlayInput(
    on ? "on" : "off",
    pitch,
    velocity,
    playhead,
  );
  if (result) state.recordHit(pitch, result);
}

export function stopPractice(aborted: boolean): void {
  const state = useAppStore.getState();
  const timeline = activeTimeline;
  if (!state.running || !timeline || !judge) return;
  cancelAnimationFrame(frame);
  clearTimeout(finishTimer);
  finishTimer = 0;
  stopClock();
  const { events, summary } = judge.finish(aborted);
  state.set({
    running: false,
    lessonState: "reviewing",
    handsMode: "hidden",
    subtitle: aborted
      ? "演奏を停止しました"
      : "おつかれさま！ 結果を確認しています。",
  });
  send("attempt.submit", {
    exerciseId: timeline.exerciseId,
    exerciseVersion: timeline.exerciseVersion,
    mode: timeline.spec.mode === "wait" ? "wait" : "play",
    events,
    summary,
  });
  judge = null;
  activeTimeline = null;
}

export function playDemo(): void {
  const timeline = currentTimeline();
  const state = useAppStore.getState();
  if (state.lessonState !== "demo" || timeline?.spec.mode !== "watch") return;
  cancelCountIn();
  cancelAnimationFrame(frame);
  clearTimeout(finishTimer);
  finishTimer = 0;
  activeTimeline = timeline;
  demoTriggered = new Set();
  slowedEventId = null;
  setTimeScale(1);
  startClock(0);
  state.set({
    running: true,
    lessonState: "demo",
    handsMode: "demo",
    subtitle: "お手本を聴いてみましょう",
  });
  frame = requestAnimationFrame(loop);
}

function playDemoNotes(timeline: ExerciseTimeline, playhead: number): void {
  for (const note of timeline.notes) {
    if (note.startMs <= playhead && !demoTriggered.has(note.playId)) {
      demoTriggered.add(note.playId);
      playPiano(note.pitch, note.durationMs / 1000);
    }
  }

  const event = timeline.fingeringEvents.find((item) => {
    const note = timeline.notes.find(
      (candidate) => candidate.sourceNoteId === item.noteId,
    );
    return (
      note && playhead >= note.startMs - 600 && playhead <= note.startMs + 400
    );
  });
  if (event && slowedEventId !== event.noteId) {
    slowedEventId = event.noteId;
    setTimeScale(0.5);
    useAppStore.getState().set({ camera: "closeup", subtitle: event.tip });
  } else if (!event && slowedEventId) {
    slowedEventId = null;
    setTimeScale(1);
    useAppStore.getState().set({ camera: "play" });
  }

  if (playhead > lastEnd(timeline) + 250) {
    cancelAnimationFrame(frame);
    stopClock();
    setTimeScale(1);
    // お手本の後は、先生が次の課題を決めるまで待つ（開始ボタンは出さない）
    useAppStore.getState().set({
      running: false,
      lessonState: "reviewing",
      waitingForStart: false,
      handsMode: "hidden",
    });
    send("demo.finished", {
      exerciseId: timeline.exerciseId,
      exerciseVersion: timeline.exerciseVersion,
    });
    activeTimeline = null;
  }
}

/** カウントインだけを取り消す。課題の差し替えや MIDI 切断時に使う。 */
export function cancelCountIn(): void {
  if (!countInTimer) return;
  clearTimeout(countInTimer);
  countInTimer = 0;
  Tone.getTransport().stop();
  Tone.getTransport().cancel(0);
  stopClock();
  activeTimeline = null;
  useAppStore.getState().set({ waitingForStart: false, handsMode: "hidden" });
}

/** サーバー切断時など、送信を伴わずにすべての再生を止める。 */
export function abortPlayback(): void {
  cancelCountIn();
  cancelAnimationFrame(frame);
  clearTimeout(finishTimer);
  finishTimer = 0;
  Tone.getTransport().stop();
  Tone.getTransport().cancel(0);
  stopClock();
  setTimeScale(1);
  judge = null;
  activeTimeline = null;
  useAppStore.getState().set({
    running: false,
    waitingForStart: false,
    handsMode: "hidden",
    pressed: new Set(),
  });
}

function lastEnd(timeline: ExerciseTimeline): number {
  return Math.max(
    0,
    ...timeline.notes.map(
      (note: TimelineNote) => note.startMs + note.durationMs,
    ),
  );
}
