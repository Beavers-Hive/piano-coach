export type Hand = "right" | "left";
export type Finger = 1 | 2 | 3 | 4 | 5;
export type LessonState =
  | "idle"
  | "importing"
  | "analyzing"
  | "hearing"
  | "planning"
  | "briefing"
  | "demo"
  | "practicing"
  | "reviewing"
  | "finished";
export type CameraPreset = "overview" | "play" | "closeup" | "score";
export type ScoreNote = {
  id: string;
  pitch: number;
  startTick: number;
  durationTick: number;
  hand: Hand;
  measure: number;
  beat: number;
  finger?: Finger;
  fingerSource?: "agent" | "estimated";
};
export type ScoreModel = {
  songId: string;
  title: string;
  composer: string;
  ppq: 480;
  timeSignature: { num: number; den: number };
  bpm: number;
  keyFifths: number;
  measures: { index: number; startTick: number; endTick: number }[];
  notes: ScoreNote[];
};
export type ExerciseSpec = {
  measures: [number, number];
  hand: "right" | "left" | "both";
  tempoPercent: number;
  mode: "watch" | "wait" | "play";
  loop: number;
  metronome: boolean;
  focus?: string;
};
export type TimelineNote = {
  playId: string;
  sourceNoteId: string;
  measure: number;
  loopIndex: number;
  pitch: number;
  startMs: number;
  durationMs: number;
  hand: Hand;
  finger?: Finger;
};
export type FingeringEvent = {
  noteId: string;
  type: "thumb_under" | "finger_over" | "position_shift" | "stretch";
  measure: number;
  tip: string;
};
export type ExerciseTimeline = {
  exerciseId: string;
  exerciseVersion: number;
  spec: ExerciseSpec;
  bpm: number;
  beatsPerMeasure: number;
  countInMs: number;
  notes: TimelineNote[];
  fingeringEvents: FingeringEvent[];
};
export type MidiEvent = {
  t: number;
  kind: "on" | "off" | "pedal";
  pitch: number;
  velocity: number;
};
export type RealtimeSummary = {
  total: number;
  perfect: number;
  good: number;
  miss: number;
  extra: number;
  timingMeanMs: number | null;
  timingStdMs: number | null;
  perMeasure: {
    measure: number;
    miss: number;
    extra: number;
    meanAbsMs: number | null;
  }[];
  aborted: boolean;
};
export type Plan = {
  goal: string;
  steps: {
    id: string;
    title: string;
    description: string;
    status: "todo" | "doing" | "done";
  }[];
  currentStepId: string | null;
};
export type WireMessage = { type: string; payload: Record<string, unknown> };
