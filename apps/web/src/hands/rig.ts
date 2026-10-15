import {
  BufferAttribute,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Bone,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Finger, Hand } from "../types";
import { solveChain } from "./ik";
import { HAND_SCALE, type HandPose, type Vec3 } from "./pose";

/**
 * WebXR の標準の手の骨格（generic-hand）を、指先の目標へ向けて動かす。
 *
 * モデルは、手首・中手骨・各指の 3 節がすべて「同じ階層の兄弟」として入っている（ワールドの位置と向きが
 * 直接入っている）。ここで、手首 → 中手骨 → 基節骨 → …… の親子関係に付け替えてから、
 * 節ごとに「ワールドの向き」を求め、親のローカルの向きへ変換して書き込む。
 * 子ボーンのローカル位置は変えないので、骨の長さは必ず保たれる。
 */

export const FINGER_PREFIXES = [
  "thumb",
  "index-finger",
  "middle-finger",
  "ring-finger",
  "pinky-finger",
] as const;

/**
 * 指先の関節の目標を、鍵の接触点（pose の指先）からずらす量（ワールド、メートル）。
 * 指の肉の厚みの分だけ持ち上げる。親指は、鍵の手前寄りを押す（実際の奏法でも、親指は他の指より
 * 鍵の手前側に触れる。これで、和音で親指が届かなくなることを防ぐ）。
 */
export const PAD_OFFSETS: readonly Vec3[] = [
  { x: 0, y: 0.0075, z: 0.018 },
  { x: 0, y: 0.0065, z: 0 },
  { x: 0, y: 0.0065, z: 0 },
  { x: 0, y: 0.0065, z: 0 },
  { x: 0, y: 0.0065, z: 0 },
];
/** 指の第 3 関節が第 2 関節に連動して曲がる割合（人の指は DIP ≒ 0.6 × PIP）。 */
const FINGER_COUPLING = 0.62;
const THUMB_COUPLING = 0.55;
/** 親指の曲げの向き（極）に混ぜる、手の外側（親指側）の成分。 */
const THUMB_POLE_OUT = 0.35;

type Chain = {
  finger: Finger;
  bones: [Bone, Bone, Bone];
  tip: Bone;
  /** 節のワールドの休息姿勢（モデル空間）。 */
  restQuat: [Quaternion, Quaternion, Quaternion];
  restDir: [Vector3, Vector3, Vector3];
  restBack: [Vector3, Vector3, Vector3];
  /** 付け根（親指は手根中手関節、他の指は MP 関節）の休息位置。 */
  root: Vector3;
  lengths: [number, number, number];
  parentQuat: Quaternion;
  pole: Vector3;
  coupling: number;
};

function findBone(model: Object3D, name: string): Bone {
  const found = model.getObjectByName(name);
  if (!found) throw new Error(`hand model has no bone "${name}"`);
  return found as Bone;
}

export type SkinFingerMap = {
  /** 頂点ごとの、いちばん重みの大きい指（0 = 手のひら、1〜5 = 指）。 */
  finger: Float32Array;
  /** その指の先端寄りほど 1 に近い、発光の強さ。 */
  tipness: Float32Array;
};

/** 節の名前から、指の番号と、先端寄りの度合い（発光に使う）を返す。 */
export function boneFingerInfo(
  name: string,
): { finger: Finger; level: number } | null {
  const finger = FINGER_PREFIXES.findIndex((prefix) => name.startsWith(prefix));
  if (finger < 0) return null;
  let level = 0;
  if (name.includes("metacarpal")) level = 0;
  else if (name.includes("proximal")) level = finger === 0 ? 0.4 : 0.22;
  else if (name.includes("intermediate")) level = 0.6;
  else if (name.includes("distal")) level = finger === 0 ? 0.85 : 0.9;
  else if (name.includes("tip")) level = 1;
  return { finger: (finger + 1) as Finger, level };
}

export class HandRig {
  /** シーンに追加するルート。手首の位置・向き・スケールはここに与える。 */
  readonly root = new Group();
  readonly model: Object3D;
  readonly meshes: SkinnedMesh[] = [];
  /** 手首に付く袖。材質は呼び出し側が与える。 */
  readonly sleeve: Mesh;
  readonly hand: Hand;
  readonly scale: number;
  private readonly wrist: Bone;
  private readonly wristRest = new Vector3();
  private readonly neutral = new Quaternion();
  private readonly chains: Chain[] = [];
  private readonly dorsal = new Vector3();

  private readonly euler = new Euler();
  private readonly poseQuat = new Quaternion();
  private readonly invQuat = new Quaternion();
  private readonly joints: [Vector3, Vector3, Vector3, Vector3] = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
  ];
  private readonly target = new Vector3();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly normal = new Vector3();
  private readonly tmpDir = new Vector3();
  private readonly q = new Quaternion();
  private readonly qRoll = new Quaternion();
  private readonly qWorld = new Quaternion();
  private readonly qParent = new Quaternion();
  private lastResidual = 0;

  constructor(source: Object3D, hand: Hand, scale = HAND_SCALE) {
    this.hand = hand;
    this.scale = scale;
    this.model = cloneSkinned(source);
    this.model.updateMatrixWorld(true);
    this.model.traverse((object) => {
      const mesh = object as SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
      }
    });
    this.wrist = findBone(this.model, "wrist");
    this.wrist.getWorldPosition(this.wristRest);

    const rest = (bone: Bone) => ({
      pos: bone.getWorldPosition(new Vector3()),
      quat: bone.getWorldQuaternion(new Quaternion()),
    });
    // 手の座標系（モデル空間）: 前 = 手首 → 中指の付け根、背（手の甲）の向き、小指側
    const middle = rest(findBone(this.model, "middle-finger-phalanx-proximal"));
    const index = rest(findBone(this.model, "index-finger-phalanx-proximal"));
    const pinky = rest(findBone(this.model, "pinky-finger-phalanx-proximal"));
    const forward = middle.pos.clone().sub(this.wristRest).normalize();
    const lateral = pinky.pos.clone().sub(index.pos);
    const normal = new Vector3().crossVectors(forward, lateral).normalize();
    // 右手: 前 × 小指側 が手のひら側を向く。左手のモデルは鏡像なので逆になる
    this.dorsal.copy(normal).multiplyScalar(hand === "right" ? -1 : 1);
    const zAxis = forward
      .clone()
      .addScaledVector(this.dorsal, -forward.dot(this.dorsal))
      .normalize()
      .negate();
    const xAxis = new Vector3().crossVectors(this.dorsal, zAxis).normalize();
    // 手の休息姿勢を、「指が奥（-z）を向き、甲が上（+y）」の姿勢へ回す回転
    const worldToModel = new Matrix4().makeBasis(xAxis, this.dorsal, zAxis);
    this.neutral.setFromRotationMatrix(worldToModel).invert();

    const outward = lateral.clone().normalize().negate(); // 小指と反対 = 親指側
    const fingerPole = this.dorsal.clone();
    const thumbPole = this.dorsal
      .clone()
      .addScaledVector(outward, THUMB_POLE_OUT)
      .normalize();

    // 階層を付け替える（ワールドの位置と向きは保たれる）
    for (let f = 0; f < 5; f++) {
      const prefix = FINGER_PREFIXES[f];
      const names =
        f === 0
          ? [
              "thumb-metacarpal",
              "thumb-phalanx-proximal",
              "thumb-phalanx-distal",
              "thumb-tip",
            ]
          : [
              `${prefix}-metacarpal`,
              `${prefix}-phalanx-proximal`,
              `${prefix}-phalanx-intermediate`,
              `${prefix}-phalanx-distal`,
              `${prefix}-tip`,
            ];
      const bones = names.map((name) => findBone(this.model, name));
      this.wrist.attach(bones[0]);
      for (let i = 1; i < bones.length; i++) bones[i - 1].attach(bones[i]);
      this.chains.push(
        this.makeChain(
          (f + 1) as Finger,
          f === 0 ? bones : bones.slice(1),
          f === 0 ? this.wrist : bones[0],
          f === 0 ? thumbPole : fingerPole,
          f === 0 ? THUMB_COUPLING : FINGER_COUPLING,
        ),
      );
    }
    // 手首の切り口を隠す袖（楕円の筒）。手首のボーンの子にして、手首と一緒に動かす
    const length = 0.17;
    const geometry = new CylinderGeometry(1.35, 1, length, 32, 1, true);
    this.sleeve = new Mesh(geometry);
    this.sleeve.scale.set(0.027, 1, 0.035); // モデル空間の x = 背側、z = 小指側
    this.sleeve.position.set(
      this.wristRest.x,
      this.wristRest.y + 0.008 + length / 2,
      this.wristRest.z,
    );
    this.sleeve.frustumCulled = false;
    this.model.add(this.sleeve);
    this.wrist.attach(this.sleeve);
    this.root.add(this.model);
    this.root.updateMatrixWorld(true);
  }

  private makeChain(
    finger: Finger,
    bones: Bone[],
    parent: Bone,
    pole: Vector3,
    coupling: number,
  ): Chain {
    this.model.updateMatrixWorld(true);
    const positions = bones.map((bone) => bone.getWorldPosition(new Vector3()));
    const restQuat = bones
      .slice(0, 3)
      .map((bone) => bone.getWorldQuaternion(new Quaternion()));
    const restDir = [0, 1, 2].map((i) =>
      positions[i + 1].clone().sub(positions[i]).normalize(),
    );
    const lengths = [0, 1, 2].map((i) =>
      positions[i + 1].distanceTo(positions[i]),
    );
    const restBack = restDir.map((dir) =>
      this.dorsal
        .clone()
        .addScaledVector(dir, -this.dorsal.dot(dir))
        .normalize(),
    );
    return {
      finger,
      bones: bones.slice(0, 3) as [Bone, Bone, Bone],
      tip: bones[3],
      restQuat: restQuat as Chain["restQuat"],
      restDir: restDir as Chain["restDir"],
      restBack: restBack as Chain["restBack"],
      root: positions[0],
      lengths: lengths as Chain["lengths"],
      parentQuat: parent.getWorldQuaternion(new Quaternion()),
      pole,
      coupling,
    };
  }

  /** 各指の骨の長さ（モデル空間。スケール前）。テストと確認用。 */
  boneLengths(finger: Finger): readonly [number, number, number] {
    return this.chains[finger - 1].lengths;
  }

  /** 直前の update で、指先が目標に届かなかった距離の最大値（メートル、ワールド）。 */
  get reachResidual(): number {
    return this.lastResidual;
  }

  /**
   * 手首のワールドの位置・向き、各指の目標を与えて、ボーンを更新する。
   * offset は、使わない手を鍵盤の外へ下げるときの平行移動。
   */
  update(pose: HandPose, offset: Vec3): void {
    const rotation = pose.wrist.rotation;
    this.euler.set(rotation.x, rotation.y, rotation.z, "XYZ");
    this.poseQuat.setFromEuler(this.euler);
    this.root.quaternion.copy(this.poseQuat).multiply(this.neutral);
    this.root.scale.setScalar(this.scale);
    const position = pose.wrist.position;
    this.tmpA
      .copy(this.wristRest)
      .multiplyScalar(this.scale)
      .applyQuaternion(this.root.quaternion);
    this.root.position.set(
      position.x + offset.x - this.tmpA.x,
      position.y + offset.y - this.tmpA.y,
      position.z + offset.z - this.tmpA.z,
    );
    this.invQuat.copy(this.root.quaternion).invert();

    let worst = 0;
    for (const chain of this.chains) {
      const fingerPose = pose.fingers[chain.finger - 1];
      // ワールドの目標 → モデル空間
      const pad = PAD_OFFSETS[chain.finger - 1];
      this.target
        .set(
          fingerPose.tip.x + offset.x + pad.x,
          fingerPose.tip.y + offset.y + pad.y,
          fingerPose.tip.z + offset.z + pad.z,
        )
        .sub(this.root.position)
        .applyQuaternion(this.invQuat)
        .multiplyScalar(1 / this.scale);
      const residual = solveChain(
        chain.root,
        this.target,
        chain.lengths,
        chain.pole,
        chain.coupling,
        this.joints,
        this.normal,
      );
      worst = Math.max(worst, residual * this.scale);
      this.applyChain(chain);
    }
    this.lastResidual = worst;
  }

  /** this.joints の関節位置へ向くように、3 節の向きを書き込む。 */
  private applyChain(chain: Chain): void {
    this.qParent.copy(chain.parentQuat);
    for (let i = 0; i < 3; i++) {
      this.tmpDir.subVectors(this.joints[i + 1], this.joints[i]).normalize();
      // 1) 休息姿勢の向きから、新しい向きへの最小の回転
      this.q.setFromUnitVectors(chain.restDir[i], this.tmpDir);
      // 2) 節の背（甲側）が、曲げの平面の中で極の側を向くように、節の軸まわりのひねりを補正する。
      //    背の目標 = 平面の法線 × 節の向き（常に節に垂直で、平面の中にある。極そのものを使うと、
      //    指先が真下を向くときに向きが定まらず、反転する）
      this.tmpA.copy(chain.restBack[i]).applyQuaternion(this.q);
      this.tmpB.crossVectors(this.normal, this.tmpDir);
      if (this.tmpB.lengthSq() > 1e-10) {
        this.tmpB.normalize();
        this.tmpC.crossVectors(this.tmpA, this.tmpB);
        const roll = Math.atan2(
          this.tmpDir.dot(this.tmpC),
          this.tmpA.dot(this.tmpB),
        );
        this.qRoll.setFromAxisAngle(this.tmpDir, roll);
        this.q.premultiply(this.qRoll);
      }
      this.qWorld.copy(this.q).multiply(chain.restQuat[i]);
      // 3) 親のローカル座標へ変換して書き込む
      chain.bones[i].quaternion
        .copy(this.qParent)
        .invert()
        .multiply(this.qWorld);
      this.qParent.copy(this.qWorld);
    }
  }

  /** 3D 上の指先（指先の関節）のワールド位置。テストと確認用。 */
  tipWorld(finger: Finger, out: Vector3): Vector3 {
    this.root.updateMatrixWorld(true);
    return this.chains[finger - 1].tip.getWorldPosition(out);
  }

  /** ボーン名 → 指の番号と先端寄りの度合いを頂点ごとに計算する（発光用。ジオメトリごとに 1 回）。 */
  buildSkinFingerMap(mesh: SkinnedMesh): SkinFingerMap {
    const geometry = mesh.geometry;
    const skinIndex = geometry.getAttribute("skinIndex") as BufferAttribute;
    const skinWeight = geometry.getAttribute("skinWeight") as BufferAttribute;
    const count = skinIndex.count;
    const finger = new Float32Array(count);
    const tipness = new Float32Array(count);
    const infos = mesh.skeleton.bones.map((bone) => boneFingerInfo(bone.name));
    const sums = new Float32Array(6);
    const levels = new Float32Array(6);
    for (let i = 0; i < count; i++) {
      sums.fill(0);
      levels.fill(0);
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(i, k);
        if (weight <= 0) continue;
        const info = infos[skinIndex.getComponent(i, k)];
        const slot = info ? info.finger : 0;
        sums[slot] += weight;
        if (info) levels[slot] += weight * info.level;
      }
      let best = 0;
      let bestWeight = 0;
      for (let slot = 1; slot <= 5; slot++) {
        if (sums[slot] > bestWeight) {
          bestWeight = sums[slot];
          best = slot;
        }
      }
      finger[i] = best;
      tipness[i] = best ? levels[best] : 0;
    }
    return { finger, tipness };
  }
}
