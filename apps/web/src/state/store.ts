import { create } from "zustand";
import type {
  CameraPreset,
  ExerciseTimeline,
  Finger,
  LessonState,
  Plan,
  ScoreModel,
} from "../types";

export type HitKind = "perfect" | "good" | "miss" | "extra";
type AppState = {
  ready: boolean;
  samplerReady: boolean;
  midiPorts: string[];
  midiUnavailable: boolean;
  selectedPort?: string;
  midiTest?: string;
  health?: { claude: boolean; tts: boolean };
  lessonState: LessonState;
  score?: ScoreModel;
  /** 楽譜ページの PNG の URL（song.ready で届く）。読み込み演出で使う。 */
  pageImageUrls: string[];
  /** 読み取りの進み具合（import.progress）。演出の強さに使う。 */
  importProgress?: {
    stage: "reading" | "analyzing" | "fingering";
    ratio: number;
  };
  timeline: ExerciseTimeline | null;
  plan?: Plan;
  subtitle: string;
  question?: {
    questionId: string;
    text: string;
    options: string[];
    allowFree: boolean;
  };
  fingers: Record<string, Finger>;
  pressed: Set<number>;
  running: boolean;
  waitingForStart: boolean;
  handsMode: "hidden" | "demo" | "ghost";
  camera: CameraPreset;
  hit?: { pitch: number; kind: HitKind; at: number };
  combo: number;
  voiceLevel: number;
  /** 最後に Web Speech の代替音声を使った時刻（Irodori が使えなかった）。 */
  fallbackVoiceAt?: number;
  error?: string;
  set: (patch: Partial<AppState>) => void;
  press: (pitch: number, on: boolean) => void;
  recordHit: (pitch: number, kind: HitKind) => void;
};
export const useAppStore = create<AppState>((set) => ({
  ready: false,
  samplerReady: false,
  midiPorts: [],
  midiUnavailable: false,
  lessonState: "idle",
  pageImageUrls: [],
  timeline: null,
  subtitle: "",
  fingers: {},
  pressed: new Set(),
  running: false,
  waitingForStart: false,
  handsMode: "hidden",
  camera: "overview",
  combo: 0,
  voiceLevel: 0,
  set: (patch) => set(patch),
  press: (pitch, on) =>
    set((s) => {
      const pressed = new Set(s.pressed);
      if (on) pressed.add(pitch);
      else pressed.delete(pitch);
      return { pressed };
    }),
  recordHit: (pitch, kind) =>
    set((s) => ({
      hit: { pitch, kind, at: performance.now() },
      combo: kind === "perfect" ? s.combo + 1 : 0,
    })),
}));
