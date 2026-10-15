import * as Tone from "tone";
import {
  metronome,
  outputLatencyMs,
  playGuideNote,
  playPiano,
} from "../audio/piano";
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
import { buildGuideSchedule, guideIsActive } from "./guide";
import { RealtimeJudge } from "./Judge";

let judge: RealtimeJudge | null = null;
let frame = 0;
let finishTimer = 0;
let countInTimer = 0;
let activeTimeline: ExerciseTimeline | null = null;
let demoTriggered = new Set<string>();
let slowedEventId: string | null = null;
let previewRestore: Pick<
  ReturnType<typeof useAppStore.getState>,
  "lessonState" | "waitingForStart" | "handsMode" | "subtitle" | "camera"
> | null = null;

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
  if (
    !timeline ||
    useAppStore.getState().running ||
    useAppStore.getState().generation
  )
    return;
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
    subtitle: "",
    countInBeat: null,
    handsMode: "hidden",
  });
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
  // カウントインは素早く。演奏とガイド音は課題のテンポを保つ。
  // 演奏モードでは、そのまま演奏の間もメトロノームとお手本の音を鳴らし、合わせやすくする。
  // クリックの音と、画面の数字（3, 2, 1）は、同じ時刻に切り替える。
  const guideOptions = {
    metronome: state.guideMetronome,
    notes: state.guideNotes,
  };
  const guideActive = guideIsActive(timeline, guideOptions);
  const schedule = buildGuideSchedule(timeline, {
    // 待機モードは、カウントインのクリックだけ（演奏中の目安は鳴らさない）
    metronome: guideActive && guideOptions.metronome,
    notes: guideActive && guideOptions.notes,
  });
  state.set({ countInBpm: Math.round(schedule.countInBpm) });
  for (const click of schedule.clicks) {
    transport.schedule((time) => {
      metronome(time, click.accent);
      if (click.countInBeat !== null) {
        Tone.getDraw().schedule(
          () => useAppStore.getState().set({ countInBeat: click.countInBeat }),
          time,
        );
      }
    }, click.atMs / 1000);
  }
  for (const guideNote of schedule.notes) {
    transport.schedule(
      (time) =>
        playGuideNote(guideNote.pitch, guideNote.durationMs / 1000, time),
      guideNote.atMs / 1000,
    );
  }
  // 画面の時計は、「音が実際に聞こえる時刻」に合わせる（Transport の開始 + 出力の遅れ）。
  // 画面のノーツが判定ラインに届く瞬間と、聞こえるクリック・お手本の音が揃う。
  const audibleDelayMs = 30 + outputLatencyMs();
  startClock(-schedule.countInMs, performance.now() + audibleDelayMs);
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
    judge = new RealtimeJudge(timeline);
    const wait = timeline.spec.mode === "wait";
    // 目安の音が続く間は Transport を止めず、画面の時計も 0 に戻さずにそのまま進める
    if (!guideActive) {
      transport.stop();
      transport.cancel(0);
      startClock(0);
    }
    if (wait) pauseClock();
    useAppStore.getState().set({
      running: true,
      countInBeat: null,
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
  }, schedule.countInMs + audibleDelayMs);
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
  stopGuide();
  stopClock();
  const { events, summary } = judge.finish(aborted);
  state.set({
    running: false,
    lessonState: "reviewing",
    handsMode: "hidden",
    lastResult: aborted ? undefined : { summary, at: Date.now() },
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

export function playDemo(preview = false): void {
  const timeline = currentTimeline();
  const state = useAppStore.getState();
  if (!timeline?.notes.length) return;
  if (preview) {
    if (
      state.generation ||
      state.voiceLevel > 0 ||
      (state.running && !previewRestore)
    )
      return;
    if (!previewRestore)
      previewRestore = {
        lessonState: state.lessonState,
        waitingForStart: state.waitingForStart,
        handsMode: state.handsMode,
        subtitle: state.subtitle,
        camera: state.camera,
      };
  } else {
    if (state.lessonState !== "demo" || timeline.spec.mode !== "watch") return;
    previewRestore = null;
  }
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
    cameraAuto: true,
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
    // カメラは動かさない。お手本のカメラは scene/demoCamera.ts が playhead から決める（CameraRig）
    useAppStore.getState().set({ subtitle: event.tip });
  } else if (!event && slowedEventId) {
    slowedEventId = null;
    setTimeScale(1);
  }

  if (playhead > lastEnd(timeline) + 250) {
    cancelAnimationFrame(frame);
    stopClock();
    setTimeScale(1);
    if (previewRestore) {
      const restore = previewRestore;
      previewRestore = null;
      useAppStore.getState().set({ ...restore, running: false });
      activeTimeline = null;
      return; // Local replay never advances the server lesson.
    }
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
/** 目安の音（メトロノームとお手本の音）の予定を止める。 */
function stopGuide(): void {
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
}

export function cancelCountIn(): void {
  if (!countInTimer) return;
  clearTimeout(countInTimer);
  countInTimer = 0;
  Tone.getTransport().stop();
  Tone.getTransport().cancel(0);
  stopClock();
  activeTimeline = null;
  useAppStore
    .getState()
    .set({ waitingForStart: false, handsMode: "hidden", countInBeat: null });
}

/** サーバー切断時など、送信を伴わずにすべての再生を止める。 */
export function abortPlayback(): void {
  previewRestore = null;
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
