import { enqueueVoice } from "../audio/voice";
import type { ExerciseTimeline, ScoreModel, WireMessage } from "../types";
import { useAppStore } from "./store";

let socket: WebSocket | undefined;

export function connectSocket(): void {
  if (new URLSearchParams(location.search).has("mock") || socket) return;
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
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
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type, payload }));
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
    case "agent.say":
      state.set({ subtitle: state.subtitle + String(payload.delta) });
      break;
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
