import { KEY, keyTouchPoint } from "../scene/keyboardLayout";
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
type Anchor = { at: number; x: number; z: number; release: number };

/**
 * 手のモデル（WebXR generic-hand）の大きさ。モデルは実寸の約 0.9 倍の小さめの手なので、
 * 実物のピアノの縮尺（白鍵 23.5mm 幅）で見て自然になるよう、一様に拡大する。
 */
export const HAND_SCALE = 1.12;

// 指の付け根（MP 関節）の、手首からの相対位置（右手の座標。左手は x を反転する）。モデルの骨格に合わせた値。
// 親指だけは、手根中手関節（親指の付け根）の位置。joints の計算（互換のため残している簡易 IK）にだけ使う。
const ROOT_X: Record<Hand, readonly number[]> = {
  right: [-0.0314, -0.0264, -0.0019, 0.0196, 0.0393],
  left: [0.0314, 0.0264, 0.0019, -0.0196, -0.0393],
};
const ROOT_Z = [-0.0403, -0.099, -0.1026, -0.0949, -0.0828] as const;
const ROOT_Y = [-0.0215, -0.0083, -0.0028, -0.0073, -0.0153] as const;
// 指の腹が鍵に触れるときの、手首からの相対位置。手の位置（手首の目標）はここから逆算する。
// 親指は、わざと広めに置く（5 本指のポジションが一目で分かるように）。
const CONTACT_X: Record<Hand, readonly number[]> = {
  right: [-0.046, -0.0235, 0, 0.0215, 0.042],
  left: [0.046, 0.0235, 0, -0.0215, -0.042],
};
const CONTACT_Z = [-0.116, -0.172, -0.178, -0.165, -0.135] as const;
// 手首の高さ（絶対値。白鍵の上面は約 0.022）。指の付け根は、これより数 mm 低い
const WRIST_Y = 0.07;
// 黒鍵は白鍵より奥にある。手首は、その差のこの割合だけ奥へ寄せる（残りは指を伸ばして届かせる）
const BLACK_KEY_SHIFT = 0.7;
// 打鍵していない指が、鍵の上に浮かぶ高さ（力を抜いた状態）と、鍵へ向かう・鍵から戻る時間
const HOVER_Y = 0.012;
const HOME_Y = 0.019;
const LEAD_MS = 360;
const TRAIL_MS = 330;
const REST_Y = HOVER_Y;
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
    let release = Number.POSITIVE_INFINITY;
    while (i < notes.length && Math.abs(notes[i].startMs - at) < EPSILON) {
      const note = notes[i];
      const touch = keyTouchPoint(note.pitch);
      // 黒鍵では、手首を黒鍵の奥行きの差の一部だけ奥へ寄せる
      const whiteZ = KEY.whiteLength / 2 - 0.03;
      const z = whiteZ + (touch[2] - whiteZ) * BLACK_KEY_SHIFT;
      sumX += touch[0] - CONTACT_X[hand][note.assignedFinger - 1];
      sumZ += z - CONTACT_Z[note.assignedFinger - 1];
      release = Math.min(release, note.startMs + note.durationMs);
      count++;
      i++;
    }
    anchors.push({ at, x: sumX / count, z: sumZ / count, release });
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
  // Each transition ends on the target note. A long leap starts one beat early; a small step moves
  // later and faster, once the previous keys have been released (otherwise the hand would slide
  // away while the finger is still holding its key). Applying the transitions in order keeps the
  // curve C0-continuous even when two windows overlap in a fast passage.
  let point = v(anchors[0].x, WRIST_Y, anchors[0].z);
  for (let i = 1; i < anchors.length; i++) {
    const target = anchors[i];
    const previous = anchors[i - 1];
    const leap = Math.hypot(target.x - previous.x, target.z - previous.z);
    // 大きな跳躍は、手首の速さが約 0.9m/s を超えないよう、1 拍より長くかける
    const span = Math.max(
      beatMs * clamp01(0.3 + (0.7 * (leap - 0.03)) / 0.07),
      1700 * leap,
    );
    let start = target.at - span;
    if (leap < 0.1) start = Math.max(start, previous.release);
    start = Math.min(start, target.at - Math.max(beatMs * 0.25, 1700 * leap));
    const p = smooth((tMs - start) / (target.at - start));
    point = lerp(point, v(target.x, WRIST_Y, target.z), p);
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

/** 1 つの音に対する、指の高さの動き（打鍵の 120ms 前に持ち上げ、打鍵で沈め、離鍵で戻す）。 */
function noteEnvelope(
  note: AssignedNote,
  tMs: number,
): { y: number; pressed: boolean; arc: number } | null {
  const surfaceY = keyTouchPoint(note.pitch)[1];
  const start = note.startMs;
  const end = start + note.durationMs;
  if (tMs >= start - 120 && tMs <= start) {
    // 持ち上げてから、拍の瞬間に鍵の上面へぴったり届く
    const p = clamp01((tMs - (start - 120)) / 120);
    const arc = Math.sin(Math.PI * p);
    return {
      y: surfaceY + REST_Y * (1 - p) + arc * 0.03,
      pressed: false,
      arc,
    };
  }
  if (tMs > start && tMs < end) {
    const down = smooth((tMs - start) / 38);
    const up = smooth((end - tMs) / 58);
    return {
      y: surfaceY - KEY.pressDepth * Math.min(down, up),
      pressed: true,
      arc: 0,
    };
  }
  if (tMs >= end && tMs <= end + 95) {
    const p = smooth((tMs - end) / 95);
    return {
      y: surfaceY - KEY.pressDepth * (1 - p) + REST_Y * p,
      pressed: false,
      arc: 0,
    };
  }
  return null;
}

/**
 * 1 本の指の、時刻 t での指先の目標。
 * 打鍵の前後（約 120ms 前〜離鍵の約 95ms 後）は鍵の上面に合わせる。それ以外は、直前の鍵から
 * 力を抜いた位置（home、鍵のすぐ上）へ戻り、次の鍵へ向けて少しずつ寄っていく。
 * 位置は時刻に対して連続で、打鍵の瞬間は必ず鍵の上面に一致する。
 */
function fingerMotion(
  notes: readonly AssignedNote[],
  finger: Finger,
  tMs: number,
  home: Vec3,
): {
  target: Vec3;
  pressed: boolean;
  arc: number;
  crossing: CrossingKind | null;
  note: AssignedNote | undefined;
} {
  let previous: AssignedNote | undefined;
  let next: AssignedNote | undefined;
  for (const note of notes) {
    if (note.assignedFinger !== finger) continue;
    if (note.startMs < tMs) previous = note;
    else {
      next = note;
      break;
    }
  }
  const closest = closestNoteForFinger(notes, finger, tMs);
  const nextPrep = next ? tMs >= next.startMs - 120 : false;
  const previousActive = previous
    ? tMs <= previous.startMs + previous.durationMs + 95
    : false;
  const active = nextPrep ? next : previousActive ? previous : undefined;
  let x: number;
  let y: number;
  let z: number;
  let pressed = false;
  let arc = 0;
  if (active) {
    const touch = keyTouchPoint(active.pitch);
    const envelope = noteEnvelope(active, tMs);
    x = touch[0];
    z = touch[2];
    y = envelope?.y ?? touch[1] + REST_Y;
    pressed = envelope?.pressed ?? false;
    arc = envelope?.arc ?? 0;
  } else {
    // 鍵から離れた状態。直前の鍵 → home → 次の鍵 の順に混ぜる
    let hx = home.x;
    let hy = home.y;
    let hz = home.z;
    if (previous) {
      const touch = keyTouchPoint(previous.pitch);
      const w =
        1 -
        smooth(
          (tMs - (previous.startMs + previous.durationMs + 95)) / TRAIL_MS,
        );
      hx += (touch[0] - hx) * w;
      hy += (touch[1] + REST_Y - hy) * w;
      hz += (touch[2] - hz) * w;
    }
    if (next) {
      const touch = keyTouchPoint(next.pitch);
      const w = smooth(1 - (next.startMs - 120 - tMs) / LEAD_MS);
      hx += (touch[0] - hx) * w;
      hy += (touch[1] + REST_Y - hy) * w;
      hz += (touch[2] - hz) * w;
    }
    x = hx;
    y = hy;
    z = hz;
  }
  // 指くぐり・指越えは、横への弧と、少し低い軌道で表す。拍の瞬間は目標を正確に保つ
  // （見た目の信頼と、MIDI とポーズの一致のため）。
  let lateral = 0;
  let under = 0;
  let crossing: CrossingKind | null = null;
  if (closest?.crossing) {
    const dt = Math.abs(tMs - closest.startMs);
    const crossingWindow = clamp01(1 - dt / 210);
    const awayFromKey = Math.min(1, dt / 210);
    lateral =
      crossingWindow *
      awayFromKey *
      0.021 *
      (closest.crossing === "thumb_under" ? 1 : -1);
    under =
      closest.crossing === "thumb_under"
        ? crossingWindow * awayFromKey * 0.018
        : 0;
    crossing = crossingWindow > 0.02 ? closest.crossing : null;
  }
  return {
    target: v(x + lateral, y - under, z),
    pressed,
    arc,
    crossing,
    note: closest,
  };
}

/** 力を抜いた指先の位置（手首の下、鍵のすぐ上）。 */
function homeFor(wrist: Vec3, hand: Hand, finger: Finger): Vec3 {
  return v(
    wrist.x + CONTACT_X[hand][finger - 1],
    KEY.whiteHeight + HOME_Y,
    wrist.z + CONTACT_Z[finger - 1],
  );
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
  const a = finger === 1 ? 0.037 : 0.05;
  const b = finger === 1 ? 0.038 : 0.029;
  const c = finger === 1 ? 0.017 : 0.015;
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
        const tip = homeFor(emptyWrist, hand, finger as Finger);
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
    const motion = fingerMotion(
      notes,
      index,
      tMs,
      homeFor(wristPosition, hand, index),
    );
    const root = add(
      wristPosition,
      v(ROOT_X[hand][index - 1], ROOT_Y[index - 1], ROOT_Z[index - 1]),
    );
    const target = motion.target;
    const ik = solveFinger(root, target, hand, index, motion.crossing);
    fingerPoses.push({
      finger: index,
      ...ik,
      tip: target,
      pitch: motion.note?.pitch ?? null,
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
