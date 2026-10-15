import { enqueueVoice } from "../audio/voice";
import type { ExerciseTimeline, ScoreModel, WireMessage } from "../types";
import { useAppStore } from "./store";

let socket: WebSocket | undefined;
// 接続が開く前に送ろうとしたメッセージ。開いたら順に送る（曲をすぐ選んだときに lesson.start が消えていた）
const pending: string[] = [];
let disconnected = false;

/** 声のクリップが届いた発話の ID（字幕は声に合わせて出すので、字幕だけの代替表示をしない）。 */
const voiceSpoke = new Set<string>();
// 楽譜ページを 3D 空間に浮かべる状態（ScorePages.tsx）
const PAGE_STATES = ["importing", "analyzing", "hearing", "planning"];

export function connectSocket(): void {
  if (new URLSearchParams(location.search).has("mock") || socket) return;
  disconnected = false;
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  socket.onopen = () => {
    while (pending.length && socket?.readyState === WebSocket.OPEN)
      socket.send(pending.shift()!);
  };
  socket.onmessage = (event) => {
    try {
      handleIncomingMessage(JSON.parse(event.data) as WireMessage);
    } catch {
      useAppStore
        .getState()
        .set({ error: "サーバーからのメッセージを読めませんでした" });
    }
  };
  socket.onclose = handleSocketClose;
  socket.onerror = () =>
    useAppStore
      .getState()
      .set({ error: "サーバーに接続できません", generation: null });
}

export function send(type: string, payload: Record<string, unknown>): void {
  const message = JSON.stringify({ type, payload });
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING) &&
    [
      "lesson.start",
      "hearing.answer",
      "user.message",
      "attempt.submit",
      "demo.finished",
    ].includes(type)
  ) {
    useAppStore.getState().set({ generation: "thinking" });
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(message);
  else if (!disconnected && socket?.readyState === WebSocket.CONNECTING)
    pending.push(message);
}

export function handleSocketClose(): void {
  socket = undefined;
  disconnected = true;
  pending.length = 0;
  useAppStore.getState().set({
    running: false,
    generation: null,
    waitingForStart: false,
    handsMode: "hidden",
    pressed: new Set(),
    error: "接続が切れました。ページを再読み込みしてください。",
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("piano-ws-disconnected"));
  }
}

export function handleIncomingMessage({ type, payload }: WireMessage): void {
  const state = useAppStore.getState();
  if (isStaleVersion(payload) && type !== "exercise.ready") return;

  switch (type) {
    case "lesson.state": {
      const lessonState = payload.state as typeof state.lessonState;
      // 会話中（ヒアリングや計画）は全体、課題が始まったら演奏用の構図に寄せる
      const conversational = [
        "idle",
        "importing",
        "analyzing",
        "hearing",
        "planning",
        "finished",
      ];
      // 楽譜ページを浮かべている間（読み込み演出）は、ページが入る構図にする
      const showingPages =
        state.pageImageUrls.length > 0 && PAGE_STATES.includes(lessonState);
      state.set({
        lessonState,
        ...(["importing", "analyzing", "planning", "reviewing"].includes(
          lessonState,
        )
          ? { generation: "thinking" as const }
          : ["demo", "practicing", "finished", "idle"].includes(lessonState)
            ? { generation: null }
            : {}),
        camera: showingPages
          ? "score"
          : conversational.includes(lessonState)
            ? "overview"
            : state.camera,
      });
      break;
    }
    case "import.progress":
      state.set({
        // 新しい読み込みが始まったら、前の曲のページは消す
        ...(state.lessonState === "importing" ? {} : { pageImageUrls: [] }),
        lessonState: "importing",
        generation: "thinking",
        importProgress: {
          stage: payload.stage as "reading" | "analyzing" | "fingering",
          ratio: Number(payload.ratio) || 0,
        },
      });
      break;
    case "song.ready":
      state.set({
        score: payload.score as ScoreModel,
        pageImageUrls: Array.isArray(payload.pageImageUrls)
          ? (payload.pageImageUrls as string[])
          : [],
        camera: PAGE_STATES.includes(state.lessonState)
          ? "score"
          : state.camera,
      });
      break;
    case "song.analysis":
      state.set({
        subtitle: `${String(payload.title)} — ${String(payload.summary)}`,
      });
      break;
    case "fingering.updated":
      revealFingers(
        payload.fingers as { id: string; finger: 1 | 2 | 3 | 4 | 5 }[],
      );
      break;
    case "agent.say": {
      // Text is displayed exclusively on audio playing / speech onstart.
      if (!voiceSpoke.has(String(payload.utteranceId)))
        state.set({ generation: "voice" });
      break;
    }
    case "voice.clip":
      state.set({ generation: payload.last ? null : "voice" });
      voiceSpoke.add(String((payload as { utteranceId: string }).utteranceId));
      enqueueVoice(payload as never);
      break;
    case "agent.ask":
      state.set({ question: payload as never, generation: null });
      break;
    case "plan.updated":
      state.set({ plan: payload.plan as never, generation: "thinking" });
      break;
    case "exercise.ready":
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("piano-exercise-changed"));
      }
      state.set({
        timeline: payload.timeline as ExerciseTimeline,
        waitingForStart: true,
        lessonState: "briefing",
        combo: 0,
        camera: "play",
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("piano-score-ready"));
      }
      break;
    case "demo.play":
      window.dispatchEvent(new CustomEvent("piano-demo", { detail: payload }));
      break;
    case "ui.hint":
      state.set({
        camera: (payload.cameraPreset as typeof state.camera) ?? state.camera,
      });
      break;
    case "error":
      state.set({ error: String(payload.message), generation: null });
      break;
    default:
      break;
  }
}

function isStaleVersion(payload: Record<string, unknown>): boolean {
  const active = useAppStore.getState().timeline;
  return (
    typeof payload.exerciseVersion === "number" &&
    (!active || payload.exerciseVersion !== active.exerciseVersion)
  );
}

function revealFingers(
  fingers: { id: string; finger: 1 | 2 | 3 | 4 | 5 }[],
): void {
  fingers.forEach((finger, index) => {
    window.setTimeout(() => {
      const current = useAppStore.getState();
      current.set({
        fingers: { ...current.fingers, [finger.id]: finger.finger },
      });
    }, index * 90);
  });
}
