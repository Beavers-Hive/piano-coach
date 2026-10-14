import type { ExerciseTimeline } from "../types";

const names = [
  "D5",
  "G4",
  "A4",
  "B4",
  "C5",
  "D5",
  "G4",
  "G4",
  "E5",
  "C5",
  "D5",
  "E5",
  "F#5",
  "G5",
  "G4",
  "G4",
];
const midi: Record<string, number> = {
  D5: 74,
  G4: 67,
  A4: 69,
  B4: 71,
  C5: 72,
  E5: 76,
  "F#5": 78,
  G5: 79,
};
export const mockTimeline: ExerciseTimeline = {
  exerciseId: "minuet-g-1-4",
  exerciseVersion: 1,
  bpm: 100,
  beatsPerMeasure: 3,
  countInMs: 1800,
  spec: {
    measures: [1, 4],
    hand: "right",
    tempoPercent: 100,
    mode: "wait",
    loop: 1,
    metronome: true,
    focus: "右手のメロディー",
  },
  fingeringEvents: [],
  notes: names.map((name, index) => ({
    playId: `R-${String(index + 1).padStart(4, "0")}#0`,
    sourceNoteId: `R-${String(index + 1).padStart(4, "0")}`,
    measure: Math.min(4, Math.floor(index / 4) + 1),
    loopIndex: 0,
    pitch: midi[name],
    startMs: index * 600,
    durationMs: 470,
    hand: "right",
    finger: ([3, 1, 2, 3, 4, 5, 1, 2, 3, 1, 2, 3, 4, 5, 1, 2] as const)[index],
  })),
};
export const mockSongs = [
  { songId: "minuet-g", title: "メヌエット ト長調", composer: "J. S. Bach" },
];
