import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Quaternion, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import type { ExerciseTimeline, Finger, Hand, TimelineNote } from "../types";
import { chainReach, solveChain } from "./ik";
import { computeHandPose } from "./pose";
import { HandRig, PAD_OFFSETS } from "./rig";

function loadModel(hand: Hand): Promise<Object3D> {
  const path = fileURLToPath(
    new URL(`../../public/models/hand/${hand}.glb`, import.meta.url),
  );
  const file = readFileSync(path);
  const data = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  );
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(
      data as ArrayBuffer,
      "",
      (gltf) => resolve(gltf.scene),
      reject,
    ),
  );
}

function note(
  id: number,
  pitch: number,
  startMs: number,
  finger: Finger,
  hand: Hand,
  durationMs = 420,
): TimelineNote {
  return {
    playId: `${hand}-${id}#0`,
    sourceNoteId: `${hand}-${id}`,
    measure: 1,
    loopIndex: 0,
    pitch,
    startMs,
    durationMs,
    hand,
    finger,
  };
}

/** 右手: 音階（親指くぐりを含む）と黒鍵。左手: 下降する音階と和音。 */
function bothHandsTimeline(): ExerciseTimeline {
  const rightPitches = [60, 62, 64, 65, 67, 69, 71, 72, 70, 68, 66, 64];
  const rightFingers: Finger[] = [1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1];
  const leftPitches = [48, 47, 45, 43, 41, 40, 38, 36];
  const leftFingers: Finger[] = [5, 4, 3, 2, 1, 3, 2, 1];
  const notes = [
    ...rightPitches.map((p, i) =>
      note(i, p, i * 500, rightFingers[i], "right"),
    ),
    ...leftPitches.map((p, i) => note(i, p, i * 500, leftFingers[i], "left")),
    note(90, 55, 6000, 5, "left"),
    note(91, 59, 6000, 3, "left"),
    note(92, 62, 6000, 1, "left"),
    note(93, 67, 6000, 5, "right"),
    note(94, 64, 6000, 3, "right"),
    note(95, 60, 6000, 1, "right"),
  ];
  return {
    exerciseId: "rig-test",
    exerciseVersion: 1,
    spec: {
      measures: [1, 2],
      hand: "both",
      tempoPercent: 100,
      mode: "watch",
      loop: 1,
      metronome: false,
    },
    bpm: 120,
    beatsPerMeasure: 4,
    countInMs: 0,
    notes,
    fingeringEvents: [],
  };
}

describe("solveChain", () => {
  const lengths = [0.05, 0.03, 0.015] as const;
  const joints = () =>
    [new Vector3(), new Vector3(), new Vector3(), new Vector3()] as const;

  it("reaches any target inside the finger's range and keeps the bone lengths", () => {
    const root = new Vector3(0.01, 0.07, -0.05);
    const pole = new Vector3(0, 1, 0);
    const out = joints();
    for (const distance of [0.045, 0.06, 0.075, 0.09]) {
      for (const angle of [-0.9, -0.4, 0, 0.5]) {
        const target = root
          .clone()
          .add(
            new Vector3(
              Math.sin(angle) * distance * 0.4,
              -Math.cos(angle) * distance * 0.7,
              -distance * 0.6,
            ).setLength(distance),
          );
        const residual = solveChain(root, target, lengths, pole, 0.6, out);
        expect(residual).toBeLessThan(1e-6);
        for (let i = 0; i < 3; i++)
          expect(out[i].distanceTo(out[i + 1])).toBeCloseTo(lengths[i], 7);
      }
    }
  });

  it("arches upward toward the pole", () => {
    const root = new Vector3(0, 0.07, 0);
    const target = new Vector3(0, 0.02, -0.06);
    const out = joints();
    solveChain(root, target, lengths, new Vector3(0, 1, 0), 0.6, out);
    // 第 2 関節（out[1]）は、付け根と指先を結ぶ線より上にある
    const lineY = (root.y + target.y) / 2;
    expect(out[1].y).toBeGreaterThan(lineY);
  });

  it("stretches straight toward a target that is out of reach", () => {
    const root = new Vector3();
    const target = new Vector3(0, 0, -0.3);
    const out = joints();
    const residual = solveChain(
      root,
      target,
      lengths,
      new Vector3(0, 1, 0),
      0.6,
      out,
    );
    expect(residual).toBeCloseTo(0.3 - 0.095, 6);
    expect(out[3].x).toBeCloseTo(0, 9);
    expect(out[3].z).toBeCloseTo(-0.095, 6);
  });

  it("chainReach is monotonic in the bend angle", () => {
    let last = Infinity;
    for (let theta = 0; theta <= 1.9; theta += 0.1) {
      const { distance } = chainReach(0.05, 0.03, 0.015, 0.6, theta);
      expect(distance).toBeLessThan(last);
      last = distance;
    }
  });
});

describe("HandRig (real WebXR generic-hand model)", () => {
  for (const hand of ["right", "left"] as const) {
    it(`${hand}: fingertips reach the pose targets and bones keep their length`, async () => {
      const rig = new HandRig(await loadModel(hand), hand);
      const timeline = bothHandsTimeline();
      const restLengths = ([1, 2, 3, 4, 5] as const).map((f) =>
        rig.boneLengths(f),
      );
      const tip = new Vector3();
      const world = rig.model;
      let worst = 0;
      let samples = 0;
      for (let t = -200; t <= 6600; t += 37) {
        const pose = computeHandPose(timeline, {}, hand, t);
        rig.update(pose, { x: 0, y: 0, z: 0 });
        rig.root.updateMatrixWorld(true);
        worst = Math.max(worst, rig.reachResidual);
        samples++;
        for (const finger of pose.fingers) {
          rig.tipWorld(finger.finger, tip);
          const reached = Math.hypot(
            tip.x - (finger.tip.x + PAD_OFFSETS[finger.finger - 1].x),
            tip.y - (finger.tip.y + PAD_OFFSETS[finger.finger - 1].y),
            tip.z - (finger.tip.z + PAD_OFFSETS[finger.finger - 1].z),
          );
          // 打鍵中の指は、FK の指先が目標に届く（3mm 以内）。離れている指は、届かなければ目標の方向へ伸びる
          if (finger.pressed) expect(reached).toBeLessThan(0.003);
          else expect(reached).toBeLessThanOrEqual(rig.reachResidual + 1e-4);
        }
        // 骨の長さが保たれる（ワールドで scale 倍）
        const a = new Vector3();
        const b = new Vector3();
        for (const f of [1, 2, 3, 4, 5] as const) {
          const names =
            f === 1
              ? [
                  "thumb-metacarpal",
                  "thumb-phalanx-proximal",
                  "thumb-phalanx-distal",
                ]
              : [
                  [
                    "index-finger",
                    "middle-finger",
                    "ring-finger",
                    "pinky-finger",
                  ][f - 2] + "-phalanx-proximal",
                  [
                    "index-finger",
                    "middle-finger",
                    "ring-finger",
                    "pinky-finger",
                  ][f - 2] + "-phalanx-intermediate",
                  [
                    "index-finger",
                    "middle-finger",
                    "ring-finger",
                    "pinky-finger",
                  ][f - 2] + "-phalanx-distal",
                ];
          for (let i = 0; i < 2; i++) {
            world.getObjectByName(names[i])!.getWorldPosition(a);
            world.getObjectByName(names[i + 1])!.getWorldPosition(b);
            expect(a.distanceTo(b)).toBeCloseTo(
              restLengths[f - 1][i] * rig.scale,
              5,
            );
          }
        }
      }
      expect(samples).toBeGreaterThan(100);
      expect(worst).toBeGreaterThanOrEqual(0);
    });
  }

  it("does not flip the hand: the dorsal side faces up and the fingers point away", async () => {
    const rig = new HandRig(await loadModel("right"), "right");
    const pose = computeHandPose(bothHandsTimeline(), {}, "right", 1000);
    rig.update(pose, { x: 0, y: 0, z: 0 });
    rig.root.updateMatrixWorld(true);
    const wrist = rig.model
      .getObjectByName("wrist")!
      .getWorldPosition(new Vector3());
    const middle = rig.model
      .getObjectByName("middle-finger-phalanx-proximal")!
      .getWorldPosition(new Vector3());
    expect(middle.z).toBeLessThan(wrist.z - 0.05); // 指は奥（-z）へ向かう
    expect(wrist.x).toBeCloseTo(pose.wrist.position.x, 4);
    expect(wrist.y).toBeCloseTo(pose.wrist.position.y, 4);
    expect(wrist.z).toBeCloseTo(pose.wrist.position.z, 4);
    // 親指は、小指より左（-x）
    const thumb = rig.model
      .getObjectByName("thumb-metacarpal")!
      .getWorldPosition(new Vector3());
    const pinky = rig.model
      .getObjectByName("pinky-finger-phalanx-proximal")!
      .getWorldPosition(new Vector3());
    expect(thumb.x).toBeLessThan(pinky.x);
    expect(new Quaternion().copy(rig.root.quaternion).length()).toBeCloseTo(
      1,
      6,
    );
  });

  for (const hand of ["right", "left"] as const) {
    it(`${hand}: no bone pops between frames (60fps) and the update is cheap`, async () => {
      const rig = new HandRig(await loadModel(hand), hand);
      const timeline = bothHandsTimeline();
      const bones: Object3D[] = [];
      rig.model.traverse((o) => {
        if ((o as { isBone?: boolean }).isBone) bones.push(o);
      });
      const previous = new Map<Object3D, Quaternion>();
      let worstAngle = 0;
      let lastWrist: Vector3 | null = null;
      let worstWrist = 0;
      const started = performance.now();
      let frames = 0;
      for (let t = -300; t <= 7000; t += 16) {
        const pose = computeHandPose(timeline, {}, hand, t);
        rig.update(pose, { x: 0, y: 0, z: 0 });
        frames++;
        for (const bone of bones) {
          const before = previous.get(bone);
          if (before) {
            const a = before.angleTo(bone.quaternion);
            worstAngle = Math.max(worstAngle, a);
          }
          previous.set(bone, bone.quaternion.clone());
        }
        const wrist = new Vector3(
          pose.wrist.position.x,
          pose.wrist.position.y,
          pose.wrist.position.z,
        );
        if (lastWrist)
          worstWrist = Math.max(worstWrist, wrist.distanceTo(lastWrist));
        lastWrist = wrist;
      }
      const perFrameMs = (performance.now() - started) / frames;
      // 1 フレームで、どの骨も 50 度を超えて回らない（180 度の反転がない。速い打鍵は 40 度前後まで回る）。手首は 1 フレーム 1.6cm（約 1m/s）以内
      expect(worstAngle).toBeLessThan((50 * Math.PI) / 180);
      expect(worstWrist).toBeLessThan(0.016);
      // 60fps の予算（16.7ms）に対して、ポーズ計算 + IK は十分に軽い（CI の揺れを見込んで 3ms）
      expect(perFrameMs).toBeLessThan(3);
    });
  }
});
