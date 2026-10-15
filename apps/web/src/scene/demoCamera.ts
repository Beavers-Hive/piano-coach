import type {
  ExerciseTimeline,
  FingeringEvent,
  Hand,
  TimelineNote,
} from "../types";
import { keyX } from "./keyboardLayout";

/**
 * お手本のカメラの振り付け。時刻（ミリ秒）だけから、カメラの位置・注視点・画角を決める純粋関数。
 * 状態を持たないので、巻き戻しやスロー再生、時刻を指定した撮影でも、同じ時刻なら同じ絵になる。
 *
 * 構図は「焦点（鍵盤の上の、見せたい点）のまわりを回る軌道」のパラメータ
 * （方位角 theta、仰角 phi、画角、焦点の x、収めたい幅）で表す。パラメータどうしを補間するので、
 * 角度から角度へは、直線で瞬間移動せずに、焦点を中心にした弧を描いて回り込む。
 * 距離はパラメータから毎回求める（fitDistance）。手と鍵盤の箱が、どの角度でも画面の使える帯に収まる。
 *
 * - 運指のイベントがない区間: ① 手前上 → ② 右斜め → ⑤ 真上 → ③ 左斜め → ④ 横（親指側）を、数秒ごとに巡回する。
 * - thumb_under / finger_over / position_shift / stretch の音の前後は、その動きがいちばん見える角度へ寄せる。
 * - 手の 3D モデルの姿勢には依存しない。構図は、課題の音符の位置（keyX）だけから決める。
 *
 * 座標系は keyboardLayout.ts と同じ（x = 右、y = 上、z = 手前）。描画は CameraRig の VIEW_SHIFT_UP で上へ寄るので、
 * 上の楽譜パネルと下のダイアログの間の帯に手が来るよう、注視点を上へずらしている（BAND_CENTER_Y）。
 */

export type DemoCameraView = {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
};

/** 既存の 3D シーンの画角（Scene.tsx の Canvas と同じ） */
export const DEMO_FOV = 38;
/** カメラの高さの下限。鍵盤の面（約 0.022m）よりつねに上にいる。 */
export const MIN_CAMERA_Y = 0.12;

// ---- 巡回の時間割（ミリ秒） ----
/** 同じ角度でゆっくり漂いながら留まる時間 */
const HOLD_MS = 1700;
/** 次の角度へ回り込む時間 */
const MOVE_MS = 2000;
const PERIOD_MS = HOLD_MS + MOVE_MS;
/** イベントの音の、何ms前からその角度にしておくか / 何ms後まで保つか */
const EVENT_BEFORE_MS = 800;
const EVENT_AFTER_MS = 500;
/** イベントの角度へ寄せる時間と、巡回へ戻る時間 */
const EVENT_IN_MS = 2200;
const EVENT_OUT_MS = 1500;
/** 隣り合うイベントの間で、角度から角度へ動くのに最低限かける時間 */
const MIN_MOVE_MS = 1800;
/** 音の前後、最低でもこの時間（片側）は、その角度にいる。これより近い次のイベントは、前のイベントの角度に含める。 */
const CORE_MS = 250;
const MERGE_GAP_MS = 1100;

const DEG = Math.PI / 180;

/** 構図のパラメータ。この空間で補間するので、角度の切り替えが弧になる。 */
type Rig = {
  /** 焦点の x */
  fx: number;
  /** 方位角 [rad]。0 = 手前から、+ = 右斜め前（x が正の側）から */
  theta: number;
  /** 仰角 [rad] */
  phi: number;
  /** 画面に収めたい範囲の、焦点から左右への半幅 [m]。カメラの距離は、これと手の奥行きが収まるように決まる。 */
  halfWidth: number;
  /** 画角 [deg] */
  fov: number;
};

type Analysis = {
  notes: TimelineNote[];
  minX: number;
  maxX: number;
  centerX: number;
  span: number;
  hasRight: boolean;
  hasLeft: boolean;
  /** 巡回での「親指側」の符号。右手だけなら -1（左側から）、左手だけなら +1 */
  thumbSide: -1 | 1;
  events: EventCue[];
  /** イベントごとの「この角度で見せる区間」（時刻順。隣と近すぎるときは詰めてある） */
  holds: Hold[];
};

type Hold = { rig: Rig; start: number; end: number };

type EventCue = {
  type: FingeringEvent["type"];
  startMs: number;
  hand: Hand;
  pitch: number;
};

/**
 * 収めたい範囲（箱）。x は焦点のまわり（Rig.halfWidth）、奥行きは「指先が鍵盤の奥の黒鍵に届く位置」から
 * 「手首（鍵盤の前縁より約 13cm 手前）と手の甲」まで、高さは鍵盤の面から手が上がる高さまで。
 */
const BOX_Z0 = -0.03;
const BOX_Z1 = 0.21;
const BOX_Y0 = 0.02;
const BOX_Y1 = 0.1;
const FOCUS_Y = (BOX_Y0 + BOX_Y1) / 2;
const FOCUS_Z = (BOX_Z0 + BOX_Z1) / 2;
/**
 * 画面の使える範囲。CameraRig は描画を上へ寄せている（VIEW_SHIFT_UP = 0.15）ので、
 * 寄せる前の座標（NDC、上が +1）で、上の楽譜パネルと下のダイアログを避けた帯は、おおよそ [-0.90, +0.04]。
 * 箱の中心を帯の中心（-0.43）に置き、半分の高さ 0.47、横は端のボタンを避けて ±0.86 に収める。
 */
const BAND_CENTER_Y = -0.43;
const BAND_HALF_Y = 0.47;
const BAND_HALF_X = 0.86;
/** 画面の縦横比。実際の画面は分からないので、横長のウィンドウ（16:10）を仮定する。 */
const ASPECT = 1.6;

const cache = new WeakMap<ExerciseTimeline, Analysis>();

function analyse(timeline: ExerciseTimeline): Analysis {
  const hit = cache.get(timeline);
  if (hit) return hit;
  const notes = [...timeline.notes].sort(
    (a, b) => a.startMs - b.startMs || a.pitch - b.pitch,
  );
  let minX = Infinity;
  let maxX = -Infinity;
  let hasRight = false;
  let hasLeft = false;
  for (const note of notes) {
    const x = keyX(note.pitch);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    if (note.hand === "right") hasRight = true;
    else hasLeft = true;
  }
  if (!notes.length) {
    minX = -0.15;
    maxX = 0.15;
  }
  const events: EventCue[] = [];
  for (const event of timeline.fingeringEvents ?? []) {
    for (const note of notes) {
      if (note.sourceNoteId !== event.noteId) continue;
      events.push({
        type: event.type,
        startMs: note.startMs,
        hand: note.hand,
        pitch: note.pitch,
      });
    }
  }
  events.sort((a, b) => a.startMs - b.startMs);
  const analysis: Analysis = {
    notes,
    minX,
    maxX,
    centerX: (minX + maxX) / 2,
    span: maxX - minX,
    hasRight,
    hasLeft,
    thumbSide: hasLeft && !hasRight ? 1 : -1,
    events,
    holds: [],
  };
  analysis.holds = makeHolds(analysis);
  cache.set(timeline, analysis);
  return analysis;
}

// ---- 小さな数学 ----
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const clamp01 = (n: number) => clamp(n, 0, 1);
/** なめらかに 0 → 1（始まりと終わりの傾きが 0。ゆっくり動き出し、ゆっくり止まる） */
const smoother = (n: number) => {
  const t = clamp01(n);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mixRig(a: Rig, b: Rig, t: number): Rig {
  return {
    fx: lerp(a.fx, b.fx, t),
    theta: lerp(a.theta, b.theta, t),
    phi: lerp(a.phi, b.phi, t),
    halfWidth: lerp(a.halfWidth, b.halfWidth, t),
    fov: lerp(a.fov, b.fov, t),
  };
}

// ---- 構図の部品 ----

/**
 * 箱（x は fx ± halfWidth、奥行きは手の全長、高さは手の上がる高さ）の 8 つの角を投影して、
 * 画面の使える帯に収まる、いちばん近い距離を求める。角度（theta, phi）が変わっても収まるので、
 * 横からでも真上からでも、「手と鍵盤が画面に収まる」が保たれる。
 */
function fitDistance(rig: Rig): number {
  const sinT = Math.sin(rig.theta);
  const cosT = Math.cos(rig.theta);
  const sinP = Math.sin(rig.phi);
  const cosP = Math.cos(rig.phi);
  const o = [sinT * cosP, sinP, cosT * cosP];
  const right = [cosT, 0, -sinT];
  const up = [-sinP * sinT, cosP, -sinP * cosT];
  const tanHalf = Math.tan((rig.fov * DEG) / 2);
  const corners: number[][] = [];
  for (const dx of [-rig.halfWidth, rig.halfWidth])
    for (const y of [BOX_Y0, BOX_Y1])
      for (const z of [BOX_Z0, BOX_Z1])
        corners.push([dx, y - FOCUS_Y, z - FOCUS_Z]);
  const fits = (dist: number): boolean => {
    for (const c of corners) {
      const depth = dist - (c[0] * o[0] + c[1] * o[1] + c[2] * o[2]);
      if (depth < 0.05) return false;
      const nx =
        (c[0] * right[0] + c[1] * right[1] + c[2] * right[2]) /
        (depth * tanHalf * ASPECT);
      const ny =
        (c[0] * up[0] + c[1] * up[1] + c[2] * up[2]) / (depth * tanHalf);
      if (Math.abs(nx) > BAND_HALF_X || Math.abs(ny) > BAND_HALF_Y)
        return false;
    }
    return true;
  };
  let lo = 0.2;
  let hi = 3;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * 時刻 tMs の前後に鳴る音の x の平均（滑らかな重み付け）。
 * 長い課題で、手が動く先へ、焦点を少しだけ追従させるために使う。
 */
function localCenterX(a: Analysis, tMs: number): number {
  const sigma = 1100;
  // 重みの合計がほぼ 0 になる（課題の前後の長い空白）ときは、音域の中心へなめらかに戻す
  let sum = a.centerX * 0.02;
  let weight = 0.02;
  for (const note of a.notes) {
    const dt = (note.startMs - (tMs + 250)) / sigma;
    if (Math.abs(dt) > 5) continue;
    const w = Math.exp(-0.5 * dt * dt);
    sum += keyX(note.pitch) * w;
    weight += w;
  }
  return sum / weight;
}

type ShotName = "front" | "right" | "left" | "top" | "side";

function baseShot(a: Analysis, name: ShotName, tMs: number): Rig {
  const both = a.hasLeft && a.hasRight;
  const center = a.centerX;
  const near = localCenterX(a, tMs);
  const halfSpan = a.span / 2;
  switch (name) {
    case "front":
      // 手前から。音域の全体が入る（全体の見渡し）
      return {
        fx: lerp(center, near, 0.3),
        theta: 0,
        phi: 34 * DEG,
        halfWidth: Math.max(0.17, halfSpan + 0.09),
        fov: DEMO_FOV,
      };
    case "right":
    case "left":
      // 斜め前から。手のまわりに寄って、いまの音の位置に追従する
      return {
        fx: lerp(center, near, 0.7),
        theta: (name === "right" ? 1 : -1) * 42 * DEG,
        phi: 30 * DEG,
        halfWidth: clamp(halfSpan * 0.5 + 0.1, 0.12, 0.2),
        fov: DEMO_FOV,
      };
    case "top":
      // 真上に近い高い位置から。鍵盤と指の並びを見せる
      return {
        fx: lerp(center, near, 0.6),
        theta: 0,
        phi: 64 * DEG,
        halfWidth: clamp(halfSpan * 0.7 + 0.1, 0.14, 0.26),
        fov: DEMO_FOV,
      };
    case "side":
    default:
      // 親指側の低い位置から、手の側面と指の動きを見せる。
      // 両手のときは、もう一方の手が親指側をふさぐので、外側から斜めに見せる。
      return {
        fx: near,
        theta: a.thumbSide * (both ? 62 : 74) * DEG,
        phi: (both ? 22 : 15) * DEG,
        halfWidth: both ? 0.09 : 0.055,
        fov: DEMO_FOV - 4,
      };
  }
}

/** 巡回する角度の順番。親指側に合わせて、回り込む向きをそろえる（なるべく小さな弧でつなぐ）。 */
function cycleOrder(a: Analysis): ShotName[] {
  return a.thumbSide < 0
    ? ["front", "right", "top", "left", "side"]
    : ["front", "left", "top", "right", "side"];
}

/** イベントがない区間の構図（巡回） */
function cycleRig(a: Analysis, tMs: number): Rig {
  const order = cycleOrder(a);
  const t = Math.max(0, tMs);
  const index = Math.floor(t / PERIOD_MS);
  const inPeriod = t - index * PERIOD_MS;
  const p = smoother((inPeriod - HOLD_MS) / MOVE_MS);
  const from = baseShot(a, order[index % order.length], tMs);
  const to = baseShot(a, order[(index + 1) % order.length], tMs);
  return mixRig(from, to, p);
}

/** 親指側の（その手の親指があるほうの）符号 */
function thumbSideOf(hand: Hand): -1 | 1 {
  return hand === "right" ? -1 : 1;
}

/** その動きがいちばん見える構図。イベントの音の x を焦点にする。 */
function eventRig(a: Analysis, cue: EventCue): Rig {
  const side = thumbSideOf(cue.hand);
  const x = keyX(cue.pitch);
  // 動きの前後の音の広がり（手が移動する幅）
  let lo = x;
  let hi = x;
  for (const note of a.notes) {
    if (note.hand !== cue.hand) continue;
    if (note.startMs < cue.startMs - 1100 || note.startMs > cue.startMs + 700)
      continue;
    lo = Math.min(lo, keyX(note.pitch));
    hi = Math.max(hi, keyX(note.pitch));
  }
  const extent = hi - lo;
  const midX = (lo + hi) / 2;
  // 親指側の外へ、反対の手があるか（カメラと動きの間に手が入って、指が隠れる）
  const blocked = a.notes.some(
    (note) =>
      note.hand !== cue.hand &&
      Math.abs(note.startMs - cue.startMs) < 1500 &&
      Math.sign(keyX(note.pitch) - x) === side &&
      Math.abs(keyX(note.pitch) - x) > 0.03,
  );
  switch (cue.type) {
    case "thumb_under":
      // 親指がくぐる動きは、真横の低い位置から。反対の手が手前にあるときは、斜め上から。
      return {
        fx: lerp(x, midX, 0.5),
        theta: side * (blocked ? 50 : 70) * DEG,
        phi: (blocked ? 30 : 14) * DEG,
        halfWidth: Math.max(0.06, extent / 2 + 0.04),
        fov: DEMO_FOV - (blocked ? 0 : 5),
      };
    case "finger_over":
      // 指が親指を越える動きは、親指側の斜め前から、低めに
      return {
        fx: lerp(x, midX, 0.5),
        theta: side * (blocked ? 38 : 56) * DEG,
        phi: (blocked ? 30 : 20) * DEG,
        halfWidth: Math.max(0.09, extent / 2 + 0.05),
        fov: DEMO_FOV - 3,
      };
    case "position_shift":
      // 手の移動は、真上に近い高い位置から。移動の前後がどちらも収まる距離
      return {
        fx: midX,
        theta: side * 16 * DEG,
        phi: 66 * DEG,
        halfWidth: Math.max(0.12, extent / 2 + 0.08),
        fov: DEMO_FOV,
      };
    case "stretch":
    default:
      // 指を大きく広げる動きは、斜め上から、広がりが全部入るように
      return {
        fx: midX,
        theta: -side * 30 * DEG,
        phi: 48 * DEG,
        halfWidth: Math.max(0.09, extent / 2 + 0.06),
        fov: DEMO_FOV,
      };
  }
}

/**
 * イベントごとの「見せる区間」を作る。音の約 800ms 前から約 500ms 後まで。
 * 次のイベントが近いときは、角度から角度へ動く時間（MIN_MOVE_MS）を残すよう、前の区間の終わりを詰める。
 */
function makeHolds(a: Analysis): Hold[] {
  // 近すぎるイベント（1 つ前から約 1.1 秒以内）は、角度を切り替えても間に合わないので、前のイベントの角度のまま通す
  const cues: EventCue[] = [];
  for (const cue of a.events) {
    const last = cues[cues.length - 1];
    if (last && cue.startMs - last.startMs < MERGE_GAP_MS) continue;
    cues.push(cue);
  }
  const holds: Hold[] = cues.map((cue) => ({
    rig: eventRig(a, cue),
    start: cue.startMs - EVENT_BEFORE_MS,
    end: cue.startMs + EVENT_AFTER_MS,
  }));
  // 隣り合う角度の間に、回り込む時間（MIN_MOVE_MS）が足りないときは、音のごく近く（CORE_MS）まで、
  // 前の区間の終わりと次の区間の始まりを、半分ずつ詰めて、時間を作る
  for (let i = 0; i < holds.length - 1; i += 1) {
    const here = cues[i].startMs;
    const there = cues[i + 1].startMs;
    const lack = MIN_MOVE_MS - (holds[i + 1].start - holds[i].end);
    if (lack > 0) {
      const cutEnd = Math.min(lack / 2, holds[i].end - (here + CORE_MS));
      holds[i].end -= Math.max(0, cutEnd);
      const rest = lack - Math.max(0, cutEnd);
      const cutStart = Math.min(rest, there - CORE_MS - holds[i + 1].start);
      holds[i + 1].start += Math.max(0, cutStart);
      // 次の区間の始まりを詰めても足りなければ、前の区間の終わりをさらに詰める
      const left = rest - Math.max(0, cutStart);
      if (left > 0)
        holds[i].end -= Math.min(
          left,
          Math.max(0, holds[i].end - (here + CORE_MS)),
        );
    }
  }
  return holds;
}

function rigAt(a: Analysis, tMs: number): Rig {
  const base = cycleRig(a, tMs);
  const holds = a.holds;
  if (!holds.length) return base;
  let prev: Hold | undefined;
  let next: Hold | undefined;
  for (const hold of holds) {
    if (tMs >= hold.start && tMs <= hold.end) return hold.rig;
    if (hold.end < tMs) prev = hold;
    else if (!next && hold.start > tMs) next = hold;
  }
  if (prev && next) {
    const gap = next.start - prev.end;
    if (gap < EVENT_IN_MS + EVENT_OUT_MS) {
      // 近いイベントどうしは、巡回に戻らず、角度から角度へ直接回り込む
      return mixRig(prev.rig, next.rig, smoother((tMs - prev.end) / gap));
    }
  }
  let rig = base;
  if (prev) {
    const out = 1 - smoother((tMs - prev.end) / EVENT_OUT_MS);
    if (out > 0) rig = mixRig(rig, prev.rig, out);
  }
  if (next) {
    const into = smoother((tMs - (next.start - EVENT_IN_MS)) / EVENT_IN_MS);
    if (into > 0) rig = mixRig(rig, next.rig, into);
  }
  return rig;
}

/** 留まっているあいだも、止まった絵にならないよう、ごくゆっくり漂わせる。 */
function drift(rig: Rig, tMs: number): Rig {
  const t = Math.max(0, tMs);
  return {
    ...rig,
    theta: rig.theta + Math.sin(t / 2300) * 2.2 * DEG,
    phi: rig.phi + Math.sin(t / 3100 + 1) * 0.9 * DEG,
  };
}

/** 軌道のパラメータを、実際のカメラの位置と注視点にする。 */
function toView(rig: Rig): DemoCameraView {
  const dist = fitDistance(rig);
  const sinT = Math.sin(rig.theta);
  const cosT = Math.cos(rig.theta);
  const sinP = Math.sin(rig.phi);
  const cosP = Math.cos(rig.phi);
  // 焦点からカメラへの向き
  const ox = sinT * cosP;
  const oy = sinP;
  const oz = cosT * cosP;
  // カメラの上方向（世界の上を、視線に垂直な面へ射影したもの）
  const ux = -sinP * sinT;
  const uy = cosP;
  const uz = -sinP * cosT;
  // 描画は上へ寄っているので、収めたい箱の中心が画面の使える帯の中心に来るよう、注視点をカメラの上方向へずらす
  const lift = -BAND_CENTER_Y * Math.tan((rig.fov * DEG) / 2) * dist;
  const target = {
    x: rig.fx + ux * lift,
    y: FOCUS_Y + uy * lift,
    z: FOCUS_Z + uz * lift,
  };
  const position = {
    x: target.x + ox * dist,
    y: Math.max(MIN_CAMERA_Y, target.y + oy * dist),
    z: target.z + oz * dist,
  };
  return { position, target, fov: rig.fov };
}

/**
 * お手本の playhead（ミリ秒）でのカメラ。同じ入力には、つねに同じ結果を返す。
 * tMs が負（カウントイン）や、課題の終わりより後でも、破綻しない。
 */
export function demoCameraAt(
  timeline: ExerciseTimeline,
  tMs: number,
): DemoCameraView {
  const t = Number.isFinite(tMs) ? tMs : 0;
  return toView(drift(rigAt(analyse(timeline), t), t));
}
