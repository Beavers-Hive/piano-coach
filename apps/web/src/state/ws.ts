import { enqueueVoice } from "../audio/voice";
import type { ExerciseTimeline, ScoreModel, WireMessage } from "../types";
import { useAppStore } from "./store";

let socket: WebSocket | undefined;
// 接続が開く前に送ろうとしたメッセージ。開いたら順に送る（曲をすぐ選んだときに lesson.start が消えていた）
const pending: string[] = [];

let lastSubtitleUtterance = "";

export function connectSocket(): void {
  if (new URLSearchParams(location.search).has("mock") || socket) return;
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
  socket.onclose = () => {
    socket = undefined;
  };
  socket.onerror = () =>
    useAppStore.getState().set({ error: "サーバーに接続できません" });
}

export function send(type: string, payload: Record<string, unknown>): void {
  const message = JSON.stringify({ type, payload });
  if (socket?.readyState === WebSocket.OPEN) socket.send(message);
  else pending.push(message);
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
      state.set({
        lessonState,
        camera: conversational.includes(lessonState)
          ? "overview"
          : state.camera,
      });
      break;
    }
    case "import.progress":
      state.set({ lessonState: "importing" });
      break;
    case "song.ready":
      state.set({ score: payload.score as ScoreModel });
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
      state.set({
        timeline: payload.timeline as ExerciseTimeline,
        waitingForStart: true,
        lessonState: "briefing",
        combo: 0,
        camera: "play",
      });
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
