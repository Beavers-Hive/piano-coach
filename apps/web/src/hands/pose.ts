import { KEY, keyTouchPoint, keyX } from "../scene/keyboardLayout";
import type {
  ExerciseTimeline,
  Finger,
  FingeringEvent,
  Hand,
  TimelineNote,
} from "../types";

/** A deliberately Three-free pose format: it is deterministic and can be tested in Node. */
export type Vec3 = { x: number; y: number; z: number };
export type CrossingKind = "thumb_under" | "finger_over";
export type FingerPose = {
  finger: Finger;
  joints: readonly [Vec3, Vec3, Vec3, Vec3];
  tip: Vec3;
  bend: readonly [number, number, number];
  pitch: number | null;
  pressed: boolean;
  crossing: CrossingKind | null;
};
export type HandPose = {
  hand: Hand;
  wrist: { position: Vec3; rotation: Vec3 };
  palm: { center: Vec3; rotation: Vec3 };
  fingers: readonly FingerPose[];
  next: { finger: Finger; pitch: number; startMs: number } | null;
  active: boolean;
};

type AssignedNote = TimelineNote & {
  assignedFinger: Finger;
  crossing: CrossingKind | null;
};
type Anchor = { at: number; x: number; z: number };

const ROOT_X: Record<Hand, readonly number[]> = {
  // The thumb is deliberately set wider. It makes a five-note hand position legible at a glance.
  right: [-0.043, -0.022, 0, 0.021, 0.04],
  left: [0.043, 0.022, 0, -0.021, -0.04],
};
// 指の付け根（ナックル）の、手首からの奥行き。中指がいちばん奥。親指は手首寄り。
const ROOT_Z = [-0.035, -0.078, -0.084, -0.079, -0.07] as const;
// 指の付け根の高さ（手首からの相対）。親指は低い位置から生える。
const ROOT_Y = [-0.016, 0.004, 0.005, 0.004, 0.001] as const;
// 手首の高さ（絶対値。白鍵の上面は約 0.022）と、指先から手首までの奥行き
const WRIST_Y = 0.068;
const WRIST_BEHIND_TIP = 0.15;
const REST_Y = 0.055;
const EPSILON = 0.000001;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, n: number): Vec3 => v(a.x * n, a.y * n, a.z * n);
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smooth = (n: number): number => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

function eventCrossing(
  events: readonly FingeringEvent[],
  note: TimelineNote,
): CrossingKind | null {
  const event = events.find(
    (candidate) => candidate.noteId === note.sourceNoteId,
  );
  return event?.type === "thumb_under" || event?.type === "finger_over"
    ? event.type
    : null;
}

/**
 * Fill partial agent fingering without mutating the timeline. With no nearby assigned note,
 * the middle finger is the least surprising temporary choice.
 */
function assignFingers(
  notes: readonly TimelineNote[],
  fingers: Record<string, Finger>,
  hand: Hand,
  events: readonly FingeringEvent[],
): AssignedNote[] {
  const ordered = [...notes]
    .filter((note) => note.hand === hand)
    .sort((a, b) => a.startMs - b.startMs || a.pitch - b.pitch);
  const assigned: AssignedNote[] = [];
  for (const note of ordered) {
    let finger = fingers[note.sourceNoteId] ?? note.finger;
    if (!finger) {
      const previous = assigned.length
        ? assigned[assigned.length - 1]
        : undefined;
      if (previous) {
        const direction =
          Math.sign(note.pitch - previous.pitch) * (hand === "right" ? 1 : -1);
        finger = Math.max(
          1,
          Math.min(5, previous.assignedFinger + direction),
        ) as Finger;
      } else {
        finger = 3;
      }
    }
    const explicit = eventCrossing(events, note);
    let inferred: CrossingKind | null = explicit;
    if (!inferred && assigned.length) {
      const previous = assigned[assigned.length - 1];
      const ascendingForHand =
        (note.pitch - previous.pitch) * (hand === "right" ? 1 : -1) > 0;
      const descendingForHand =
        (note.pitch - previous.pitch) * (hand === "right" ? 1 : -1) < 0;
      // 親指くぐり: 親指以外の指のあと、音が（その手にとって）上がる方向へ親指をくぐらせる
      if (finger === 1 && previous.assignedFinger > 1 && ascendingForHand)
        inferred = "thumb_under";
      // 指越え: 親指のあと、音が下がる方向へ他の指が親指を越える
      // （以前は「上がる方向」で判定していたため、G4(1)→A4(2) のような自然な上行まで指越えの動きになっていた）
      else if (previous.assignedFinger === 1 && finger > 1 && descendingForHand)
        inferred = "finger_over";
    }
    assigned.push({ ...note, assignedFinger: finger, crossing: inferred });
  }
  return assigned;
}

/** Public for the crossing unit tests and for a future camera slow-motion cue. */
export function detectCrossings(
  timeline: ExerciseTimeline,
  fingers: Record<string, Finger>,
  hand: Hand,
): Map<string, CrossingKind> {
  const result = new Map<string, CrossingKind>();
  for (const note of assignFingers(
    timeline.notes,
    fingers,
    hand,
    timeline.fingeringEvents,
  )) {
    if (note.crossing) result.set(note.sourceNoteId, note.crossing);
  }
  return result;
}

function makeAnchors(notes: readonly AssignedNote[], hand: Hand): Anchor[] {
  const anchors: Anchor[] = [];
  for (let i = 0; i < notes.length;) {
    const at = notes[i].startMs;
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    while (i < notes.length && Math.abs(notes[i].startMs - at) < EPSILON) {
      const note = notes[i];
      sumX += keyX(note.pitch) - ROOT_X[hand][note.assignedFinger - 1];
      sumZ += keyTouchPoint(note.pitch)[2] - ROOT_Z[note.assignedFinger - 1];
      count++;
      i++;
    }
    anchors.push({ at, x: sumX / count, z: sumZ / count });
  }
  return anchors;
}

function wristAt(
  anchors: readonly Anchor[],
  beatMs: number,
  tMs: number,
  hand: Hand,
): Vec3 {
  if (!anchors.length) return v(hand === "right" ? 0.24 : -0.24, WRIST_Y, 0.2);
  // Every transition starts one beat before its target. Applying transitions in order keeps
  // the curve C0-continuous even when a fast passage causes two lead-in windows to overlap.
  let point = v(anchors[0].x, WRIST_Y, anchors[0].z + WRIST_BEHIND_TIP);
  for (let i = 1; i < anchors.length; i++) {
    const target = anchors[i];
    const p = smooth((tMs - (target.at - beatMs)) / beatMs);
    point = lerp(point, v(target.x, WRIST_Y, target.z + WRIST_BEHIND_TIP), p);
  }
  return point;
}

function closestNoteForFinger(
  notes: readonly AssignedNote[],
  finger: Finger,
  tMs: number,
): AssignedNote | undefined {
  let best: AssignedNote | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    if (note.assignedFinger !== finger) continue;
    const d = Math.abs(note.startMs - tMs);
    if (
      d < distance ||
      (d === distance && (best?.startMs ?? Infinity) > note.startMs)
    ) {
      best = note;
      distance = d;
    }
  }
  return best;
}

function nextNote(
  notes: readonly AssignedNote[],
  tMs: number,
): AssignedNote | undefined {
  return (
    notes.find((note) => note.startMs >= tMs - 2) ?? notes[notes.length - 1]
  );
}

function fingerMotion(
  note: AssignedNote | undefined,
  tMs: number,
): {
  target: Vec3 | null;
  pressed: boolean;
  arc: number;
  crossing: CrossingKind | null;
} {
  if (!note) return { target: null, pressed: false, arc: 0, crossing: null };
  const [x, surfaceY, z] = keyTouchPoint(note.pitch);
  const start = note.startMs;
  const end = start + note.durationMs;
  let y = surfaceY + REST_Y;
  let pressed = false;
  let arc = 0;
  if (tMs >= start - 120 && tMs <= start) {
    // A raised preparatory arc, then an exact arrival at the key surface on the beat.
    const p = clamp01((tMs - (start - 120)) / 120);
    arc = Math.sin(Math.PI * p);
    y = surfaceY + REST_Y * (1 - p) + arc * 0.045;
  } else if (tMs > start && tMs < end) {
    const down = smooth((tMs - start) / 38);
    const up = smooth((end - tMs) / 58);
    const depth = KEY.pressDepth * Math.min(down, up);
    y = surfaceY - depth;
    pressed = true;
  } else if (tMs >= end && tMs <= end + 95) {
    const p = smooth((tMs - end) / 95);
    y = surfaceY - KEY.pressDepth * (1 - p) + REST_Y * p;
  }
  // Crossing uses a lateral bow and a slightly lower path. At the beat itself the target stays
  // exact, which is important for both visual trust and MIDI/pose alignment.
  const crossingWindow = clamp01(1 - Math.abs(tMs - start) / 210);
  const awayFromKey = Math.min(1, Math.abs(tMs - start) / 210);
  const lateral = note.crossing
    ? crossingWindow *
      awayFromKey *
      0.021 *
      (note.crossing === "thumb_under" ? 1 : -1)
    : 0;
  const under =
    note.crossing === "thumb_under" ? crossingWindow * awayFromKey * 0.018 : 0;
  return {
    target: v(x + lateral, y - under, z),
    pressed,
    arc,
    crossing: crossingWindow > 0.02 ? note.crossing : null,
  };
}

function solveFinger(
  root: Vec3,
  target: Vec3,
  hand: Hand,
  finger: Finger,
  crossing: CrossingKind | null,
): { joints: [Vec3, Vec3, Vec3, Vec3]; bend: [number, number, number] } {
  const reach = sub(target, root);
  const distance = Math.max(length(reach), EPSILON);
  const direction = mul(reach, 1 / distance);
  // Two-bone IK in the vertical plane. The third phalanx follows at a fixed bend ratio.
  const a = finger === 1 ? 0.048 : 0.052;
  const b = finger === 1 ? 0.037 : 0.041;
  const c = finger === 1 ? 0.027 : 0.03;
  const twoBoneReach = Math.max(
    0.012,
    Math.min(a + b - 0.001, distance - c * 0.64),
  );
  const elbowCos = clamp01(
    (a * a + twoBoneReach * twoBoneReach - b * b) / (2 * a * twoBoneReach),
  );
  const elbowAngle = Math.acos(elbowCos);
  const bend = Math.max(
    0,
    Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (a * a + b * b - twoBoneReach * twoBoneReach) / (2 * a * b),
        ),
      ),
    ),
  );
  // 曲げの向き: 指の向きに垂直で、上向き成分を持つ方向（指が上にアーチを描く）
  const upAlong = direction.y;
  const archRaw = v(
    -direction.x * upAlong,
    1 - upAlong * upAlong,
    -direction.z * upAlong,
  );
  const archLength = Math.max(length(archRaw), EPSILON);
  const arch = mul(archRaw, 1 / archLength);
  void hand;
  const bendOffset = mul(arch, Math.sin(elbowAngle) * a * (crossing ? 1.2 : 1));
  const first = add(
    add(root, mul(direction, Math.cos(elbowAngle) * a)),
    bendOffset,
  );
  const beforeTip = sub(target, mul(direction, c));
  const second = lerp(first, beforeTip, 0.65);
  return {
    joints: [root, first, second, target],
    bend: [bend * 0.42, bend * 0.4, bend * 0.18],
  };
}

/**
 * Calculate a complete hand pose at an absolute playhead time. It has no retained state: asking
 * for t=800 after t=1200 produces precisely the same pose as asking for t=800 first.
 */
export function computeHandPose(
  timeline: ExerciseTimeline | null | undefined,
  fingers: Record<string, Finger>,
  hand: Hand,
  tMs: number,
): HandPose {
  const emptyWrist = wristAt([], 500, tMs, hand);
  if (!timeline)
    return {
      hand,
      wrist: { position: emptyWrist, rotation: v(0, 0, 0) },
      palm: {
        center: add(emptyWrist, v(0, 0.002, -0.042)),
        rotation: v(0, 0, 0),
      },
      fingers: [1, 2, 3, 4, 5].map((finger) => {
        const root = add(
          emptyWrist,
          v(ROOT_X[hand][finger - 1], ROOT_Y[finger - 1], ROOT_Z[finger - 1]),
        );
        const tip = add(root, v(0, -0.042, -0.06));
        return {
          finger: finger as Finger,
          ...solveFinger(root, tip, hand, finger as Finger, null),
          tip,
          pitch: null,
          pressed: false,
          crossing: null,
        };
      }),
      next: null,
      active: false,
    };
  const notes = assignFingers(
    timeline.notes,
    fingers,
    hand,
    timeline.fingeringEvents,
  );
  const beatMs = 60000 / Math.max(1, timeline.bpm);
  const wristPosition = wristAt(makeAnchors(notes, hand), beatMs, tMs, hand);
  const crossingNote = notes.find(
    (note) => note.crossing && Math.abs(tMs - note.startMs) < 210,
  );
  const pronation = crossingNote
    ? (crossingNote.crossing === "thumb_under" ? 0.24 : -0.15) *
      (1 - Math.abs(tMs - crossingNote.startMs) / 210)
    : 0;
  const next = nextNote(notes, tMs);
  const fingerPoses: FingerPose[] = [];
  for (let index = 1 as Finger; index <= 5; index = (index + 1) as Finger) {
    const note = closestNoteForFinger(notes, index, tMs);
    const motion = fingerMotion(note, tMs);
    const root = add(
      wristPosition,
      v(ROOT_X[hand][index - 1], ROOT_Y[index - 1], ROOT_Z[index - 1]),
    );
    const fallback = add(root, v(0, -0.04, -0.062));
    const target = motion.target ?? fallback;
    const ik = solveFinger(root, target, hand, index, motion.crossing);
    fingerPoses.push({
      finger: index,
      ...ik,
      tip: target,
      pitch: note?.pitch ?? null,
      pressed: motion.pressed,
      crossing: motion.crossing,
    });
  }
  return {
    hand,
    wrist: {
      position: wristPosition,
      rotation: v(0.05 + pronation, 0, hand === "right" ? -0.04 : 0.04),
    },
    palm: {
      center: add(wristPosition, v(0, 0.002, -0.042)),
      rotation: v(0.05 + pronation, 0, 0),
    },
    fingers: fingerPoses,
    next: next
      ? {
          finger: next.assignedFinger,
          pitch: next.pitch,
          startMs: next.startMs,
        }
      : null,
    active: notes.length > 0,
  };
}
