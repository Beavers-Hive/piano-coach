import { enqueueVoice } from "../audio/voice";
import type { ExerciseTimeline, ScoreModel, WireMessage } from "../types";
import { useAppStore } from "./store";

let socket: WebSocket | undefined;
// 接続が開く前に送ろうとしたメッセージ。開いたら順に送る（曲をすぐ選んだときに lesson.start が消えていた）
const pending: string[] = [];
let disconnected = false;

let lastSubtitleUtterance = "";
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
    useAppStore.getState().set({ error: "サーバーに接続できません" });
}

export function send(type: string, payload: Record<string, unknown>): void {
  const message = JSON.stringify({ type, payload });
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
      // 新しい発話が始まったら字幕を入れ替える（前の字幕や状態表示に付け足さない）
      const utteranceId = String(payload.utteranceId);
      const continuing = utteranceId === lastSubtitleUtterance;
      lastSubtitleUtterance = utteranceId;
      state.set({
        subtitle: (continuing ? state.subtitle : "") + String(payload.delta),
      });
      break;
    }
    case "voice.clip":
      enqueueVoice(payload as never);
      break;
    case "agent.ask":
      state.set({ question: payload as never });
      break;
    case "plan.updated":
      state.set({ plan: payload.plan as never });
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
      state.set({ error: String(payload.message) });
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
