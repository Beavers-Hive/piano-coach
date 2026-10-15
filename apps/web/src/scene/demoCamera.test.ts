import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExerciseTimeline, FingeringEvent, Hand } from "../types";
import {
  DEMO_FOV,
  MIN_CAMERA_Y,
  demoCameraAt,
  type DemoCameraView,
} from "./demoCamera";
import { keyTouchPoint, keyX } from "./keyboardLayout";

function mock(name: string): ExerciseTimeline {
  const path = fileURLToPath(
    new URL(`../../public/mock/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as ExerciseTimeline;
}

/** 指定の音を、一定の間隔で並べた課題（テスト用） */
function synthetic(
  pitches: number[],
  hand: Hand,
  events: FingeringEvent[] = [],
  stepMs = 500,
): ExerciseTimeline {
  return {
    exerciseId: "t",
    exerciseVersion: 1,
    spec: {
      measures: [1, 2],
      hand,
      tempoPercent: 100,
      mode: "watch",
      loop: 1,
      metronome: false,
    },
    bpm: 120,
    beatsPerMeasure: 4,
    countInMs: 0,
    notes: pitches.map((pitch, i) => ({
      playId: `n${i}#0`,
      sourceNoteId: `n${i}`,
      measure: 1,
      loopIndex: 0,
      pitch,
      startMs: i * stepMs,
      durationMs: stepMs * 0.9,
      hand,
    })),
    fingeringEvents: events,
  };
}

const SCALE = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];
const event = (
  noteId: string,
  type: FingeringEvent["type"],
): FingeringEvent => ({ noteId, type, measure: 1, tip: "" });

/** 焦点からカメラへの向き（方位角 [deg]、仰角 [deg]）。0° は真正面、+ は x が正の側。 */
function angles(view: DemoCameraView) {
  const dx = view.position.x - view.target.x;
  const dy = view.position.y - view.target.y;
  const dz = view.position.z - view.target.z;
  return {
    azimuth: (Math.atan2(dx, dz) * 180) / Math.PI,
    elevation: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
    distance: Math.hypot(dx, dy, dz),
  };
}

/** three.js の lookAt と同じ規則で、世界の点を NDC（寄せる前）に投影する。 */
function project(
  view: DemoCameraView,
  p: [number, number, number],
  aspect = 1.6,
) {
  const f = [
    view.target.x - view.position.x,
    view.target.y - view.position.y,
    view.target.z - view.position.z,
  ];
  const fl = Math.hypot(...f);
  const fwd = f.map((n) => n / fl);
  // right = forward × up(0,1,0)
  const rr = [-fwd[2], 0, fwd[0]];
  const rl = Math.hypot(...rr);
  const right = rr.map((n) => n / rl);
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const d = [
    p[0] - view.position.x,
    p[1] - view.position.y,
    p[2] - view.position.z,
  ];
  const depth = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
  const tan = Math.tan((view.fov * Math.PI) / 360);
  return {
    x:
      (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) /
      (depth * tan * aspect),
    y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (depth * tan),
    depth,
  };
}

const TIMELINES: [string, () => ExerciseTimeline][] = [
  ["minuet right (events)", () => mock("timeline-minuet-right.json")],
  ["minuet left (events)", () => mock("timeline-minuet-left.json")],
  ["minuet both (events)", () => mock("timeline-minuet-both.json")],
  ["scale drill (builder events)", () => mock("timeline-scale-drill.json")],
  ["synthetic, no events", () => synthetic(SCALE, "right")],
];

describe("demoCameraAt", () => {
  it("同じ入力には同じ結果を返す（順序にも依存しない）", () => {
    const timeline = mock("timeline-minuet-right.json");
    const a = demoCameraAt(timeline, 4321);
    // 別の時刻を挟んで、巻き戻しても同じ
    demoCameraAt(timeline, 9000);
    demoCameraAt(timeline, 100);
    const b = demoCameraAt(timeline, 4321);
    expect(b).toEqual(a);
    // 別のオブジェクトでも同じ（キャッシュに結果が依存しない）
    const clone = JSON.parse(JSON.stringify(timeline)) as ExerciseTimeline;
    expect(demoCameraAt(clone, 4321)).toEqual(a);
  });

  it("timeline を書き換えない", () => {
    const timeline = mock("timeline-minuet-both.json");
    const before = JSON.stringify(timeline);
    for (let t = 0; t < 12_000; t += 250) demoCameraAt(timeline, t);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  for (const [name, make] of TIMELINES) {
    describe(name, () => {
      const timeline = make();
      const xs = timeline.notes.map((n) => keyX(n.pitch));
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);

      it("時刻に対して連続（隣り合う時刻でカメラが飛ばない）", () => {
        let prev = demoCameraAt(timeline, -500);
        for (let t = -484; t <= 20_000; t += 16) {
          const view = demoCameraAt(timeline, t);
          const step = Math.hypot(
            view.position.x - prev.position.x,
            view.position.y - prev.position.y,
            view.position.z - prev.position.z,
          );
          // 16ms で 4cm 未満（約 2.5m/s 未満）。ゆっくりした弧で動く
          expect(step).toBeLessThan(0.04);
          const turn = Math.abs(angles(view).azimuth - angles(prev).azimuth);
          // 向きは 16ms で 2.5° 未満（約 150°/s 未満）
          expect(turn).toBeLessThan(2.5);
          expect(Math.abs(view.fov - prev.fov)).toBeLessThan(0.3);
          prev = view;
        }
      });

      it("カメラは、つねに鍵盤の面より十分に上にいて、近すぎない", () => {
        for (let t = -500; t <= 20_000; t += 40) {
          const view = demoCameraAt(timeline, t);
          expect(view.position.y).toBeGreaterThan(0.1);
          expect(view.position.y).toBeGreaterThanOrEqual(MIN_CAMERA_Y - 1e-9);
          const { distance } = angles(view);
          expect(distance).toBeGreaterThan(0.4);
          expect(distance).toBeLessThan(1.6);
          expect(view.fov).toBeGreaterThan(25);
          expect(view.fov).toBeLessThanOrEqual(DEMO_FOV);
          for (const n of [
            ...Object.values(view.position),
            ...Object.values(view.target),
          ])
            expect(Number.isFinite(n)).toBe(true);
        }
      });

      it("注視点は、課題の音域の x の範囲（に手の幅の余白をつけたもの）に収まる", () => {
        for (let t = 0; t <= 20_000; t += 40) {
          const view = demoCameraAt(timeline, t);
          expect(view.target.x).toBeGreaterThan(minX - 0.1);
          expect(view.target.x).toBeLessThan(maxX + 0.1);
        }
      });
    });
  }

  it("片手の課題では、鳴っている音の鍵が、いつも画面（楽譜パネルとダイアログの間の帯）に収まる", () => {
    for (const name of [
      "timeline-minuet-right.json",
      "timeline-minuet-left.json",
      "timeline-scale-drill.json",
    ]) {
      const timeline = mock(name);
      const end = Math.max(
        ...timeline.notes.map((n) => n.startMs + n.durationMs),
      );
      for (let t = 0; t < end; t += 20) {
        const view = demoCameraAt(timeline, t);
        for (const note of timeline.notes) {
          if (t < note.startMs || t > note.startMs + note.durationMs) continue;
          const ndc = project(view, keyTouchPoint(note.pitch));
          expect(ndc.depth).toBeGreaterThan(0.2);
          expect(Math.abs(ndc.x)).toBeLessThan(0.95);
          // CameraRig は描画を 15% 上へ寄せる。寄せる前の NDC の [-0.95, 0.1] が、寄せたあとの画面の 17%〜87%
          expect(ndc.y).toBeGreaterThan(-0.95);
          expect(ndc.y).toBeLessThan(0.1);
        }
      }
    }
  });

  it("イベントがない課題は、手前・右斜め・左斜め・真上・横を巡回して、数秒ごとに角度が変わる", () => {
    const timeline = synthetic(SCALE, "right");
    const seen: { azimuth: number; elevation: number }[] = [];
    for (let t = 0; t < 19_000; t += 100) {
      seen.push(angles(demoCameraAt(timeline, t)));
    }
    const azimuths = seen.map((a) => a.azimuth);
    const elevations = seen.map((a) => a.elevation);
    expect(Math.max(...azimuths)).toBeGreaterThan(35); // 右斜め
    expect(Math.min(...azimuths)).toBeLessThan(-60); // 親指側の横（右手は左側から）
    expect(Math.max(...elevations)).toBeGreaterThan(55); // 真上に近い
    expect(Math.min(...elevations)).toBeLessThan(20); // 低い横
    // 3.7 秒の巡回。最初の数秒は手前から
    const first = angles(demoCameraAt(timeline, 500));
    expect(Math.abs(first.azimuth)).toBeLessThan(8);
    // 角度は、数秒の間隔で切り替わる（1 秒の間に 60° も飛ぶことはない）
    for (let i = 10; i < seen.length; i += 1) {
      expect(Math.abs(azimuths[i] - azimuths[i - 10])).toBeLessThan(60);
    }
  });

  describe("運指のイベント", () => {
    // 右手のスケール。n7 は 8 つ目の音（startMs 3500）
    const at = 7 * 500;

    it("thumb_under: 音の約 800ms 前から約 500ms 後まで、親指側（右手なら左）の横から低く見る", () => {
      const timeline = synthetic(SCALE, "right", [event("n7", "thumb_under")]);
      for (const dt of [-700, -400, 0, 300, 450]) {
        const a = angles(demoCameraAt(timeline, at + dt));
        expect(a.azimuth).toBeLessThan(-55); // 左側から
        expect(a.azimuth).toBeGreaterThan(-90);
        expect(a.elevation).toBeLessThan(25); // 低い位置から
      }
    });

    it("thumb_under: 左手の課題では、親指側（右）の横から見る", () => {
      const timeline = synthetic(SCALE, "left", [event("n7", "thumb_under")]);
      for (const dt of [-700, 0, 450]) {
        const a = angles(demoCameraAt(timeline, at + dt));
        expect(a.azimuth).toBeGreaterThan(55);
        expect(a.elevation).toBeLessThan(25);
      }
    });

    it("thumb_under: 巡回の角度から、音の前に横へ寄り、音の後に巡回へ戻る", () => {
      const timeline = synthetic(SCALE, "right", [event("n7", "thumb_under")]);
      const before = angles(demoCameraAt(timeline, at - 3500));
      const during = angles(demoCameraAt(timeline, at));
      const after = angles(demoCameraAt(timeline, at + 2800));
      expect(during.azimuth).toBeLessThan(before.azimuth - 20);
      expect(Math.abs(after.azimuth - during.azimuth)).toBeGreaterThan(5);
    });

    it("position_shift は高い位置（真上に近い）から、stretch は斜め上から見る", () => {
      const shift = synthetic(SCALE, "right", [event("n7", "position_shift")]);
      expect(angles(demoCameraAt(shift, at)).elevation).toBeGreaterThan(55);
      const stretch = synthetic(SCALE, "right", [event("n7", "stretch")]);
      const a = angles(demoCameraAt(stretch, at));
      expect(a.elevation).toBeGreaterThan(35);
      expect(a.elevation).toBeLessThan(60);
    });

    it("両手の課題で、反対の手が親指側をふさぐときは、横ではなく斜め上から見る（指が隠れない）", () => {
      // 右手 n7 の親指側（左）に、左手の音がある
      const right = synthetic(SCALE, "right", [event("n7", "thumb_under")]);
      const left = synthetic([48, 50, 52, 53, 55, 57, 59, 60], "left", [], 900);
      const both: ExerciseTimeline = {
        ...right,
        spec: { ...right.spec, hand: "both" },
        notes: [...right.notes, ...left.notes],
      };
      const a = angles(demoCameraAt(both, at));
      expect(Math.abs(a.azimuth)).toBeLessThan(62);
      expect(a.elevation).toBeGreaterThan(25);
    });

    it("近すぎるイベントが続いても、カメラは飛ばない", () => {
      const timeline = synthetic(SCALE, "right", [
        event("n3", "thumb_under"),
        event("n4", "finger_over"),
        event("n5", "position_shift"),
        event("n9", "thumb_under"),
      ]);
      let prev = demoCameraAt(timeline, 0);
      for (let t = 16; t < 9000; t += 16) {
        const view = demoCameraAt(timeline, t);
        expect(
          Math.hypot(
            view.position.x - prev.position.x,
            view.position.y - prev.position.y,
            view.position.z - prev.position.z,
          ),
        ).toBeLessThan(0.04);
        prev = view;
      }
    });
  });

  it("音のない課題や、時刻が不正な入力でも、破綻しない", () => {
    const empty = synthetic([], "right");
    for (const t of [-5000, 0, 1234, Number.NaN]) {
      const view = demoCameraAt(empty, t);
      expect(Number.isFinite(view.position.x + view.position.y)).toBe(true);
      expect(view.position.y).toBeGreaterThan(0.1);
    }
  });
});
