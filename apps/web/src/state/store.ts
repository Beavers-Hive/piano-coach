import { create } from "zustand";
import type {
  CameraPreset,
  ExerciseTimeline,
  Finger,
  LessonState,
  Plan,
  RealtimeSummary,
  ScoreModel,
} from "../types";

const GUIDE_PREF_KEY = "piano-coach-guide";

/** 演奏モードの音の目安（メトロノーム・お手本の音）の設定を、ブラウザに保存して引き継ぐ。 */
function loadGuidePrefs(): { guideMetronome: boolean; guideNotes: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(GUIDE_PREF_KEY) ?? "{}");
    return {
      guideMetronome: saved.guideMetronome !== false,
      guideNotes: saved.guideNotes !== false,
    };
  } catch {
    return { guideMetronome: true, guideNotes: true };
  }
}

export function saveGuidePrefs(prefs: {
  guideMetronome: boolean;
  guideNotes: boolean;
}): void {
  try {
    localStorage.setItem(GUIDE_PREF_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できない環境（プライベートウィンドウなど）では、その場の設定だけで続ける
  }
}

export type HitKind = "perfect" | "good" | "miss" | "extra";
export type ViewMode = "notes" | "score" | "both";
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
  viewMode: ViewMode;
  plan?: Plan;
  subtitle: string;
  generation: "thinking" | "voice" | null;
  /** 字幕の新しい部分を、この時間（ミリ秒）で 1 文字ずつ出す。声の再生の長さに合わせる。未指定なら既定の速さ。 */
  subtitleDurationMs?: number;
  /** 字幕を更新するたびに増える番号。同じ文が続いても、タイプの演出をやり直すために使う。 */
  subtitleSeq: number;
  /** 演奏モード（自分でタイミングを合わせる）で、メトロノームを鳴らすか。 */
  guideMetronome: boolean;
  /** 演奏モードで、お手本の音（合わせる目安）を鳴らすか。 */
  guideNotes: boolean;
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
  /** お手本の再生中、カメラを自動で動かす（既定 true）。false なら camera のプリセットで固定する。 */
  cameraAuto: boolean;
  hit?: { pitch: number; kind: HitKind; at: number };
  combo: number;
  voiceLevel: number;
  /** カウントイン中の残り拍数（3/4 拍子なら 3 → 2 → 1）。カウントイン中でなければ null。 */
  countInBeat: number | null;
  /** カウントインのテンポ（これから演奏させる bpm）。 */
  countInBpm?: number;
  /** 直近の演奏の結果（stopPractice で入る）。演奏結果カードが見る。 */
  lastResult?: { summary: RealtimeSummary; at: number };
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
  viewMode: "both",
  subtitle: "",
  generation: null,
  subtitleSeq: 0,
  ...loadGuidePrefs(),
  fingers: {},
  pressed: new Set(),
  running: false,
  waitingForStart: false,
  handsMode: "hidden",
  camera: "overview",
  cameraAuto: true,
  combo: 0,
  voiceLevel: 0,
  countInBeat: null,
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
