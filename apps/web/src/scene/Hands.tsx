import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createHandMaterial, type HandMaterial } from "../hands/handMaterial";
import { computeHandPose, type HandPose, type Vec3 } from "../hands/pose";
import { HandRig } from "../hands/rig";
import { getPlayheadMs } from "../midi/clock";
import { keyTouchPoint } from "./keyboardLayout";
import { useAppStore } from "../state/store";
import type { ExerciseTimeline, Finger, Hand } from "../types";

/** 指の色（ノーツの縁取りと同じ）。1 = 親指。 */
const FINGER_COLOURS = ["#ff4355", "#ff8a2a", "#ffe64b", "#60e59a", "#55a6ff"];
const HANDS: readonly Hand[] = ["right", "left"];
const MODEL_URL: Record<Hand, string> = {
  right: "/models/hand/right.glb",
  left: "/models/hand/left.glb",
};
const TRAIL_DOTS = 11;
const GUIDE_SEGMENTS = 18;
/** 次の指の発光の強さ（控えめ）。 */
const GLOW_STRENGTH = 0.28;

type HandsStoreSnapshot = {
  timeline?: ExerciseTimeline | null;
  fingers?: Record<string, Finger>;
  handsMode?: "hidden" | "demo" | "ghost";
};

/**
 * 撮影用（?mock=1 のときだけ有効）: &handT=ミリ秒 で時刻を固定、&shotcam=x,y,z,tx,ty,tz でカメラを固定する。
 * 返したオブジェクトは window.__handShot に公開され、撮影のテストが 1 つのページで時刻とカメラを切り替えられる。
 */
type ShotParams = { handT: number | null; cam: number[] | null };
function shotParams(): ShotParams {
  const shot: ShotParams = { handT: null, cam: null };
  const search = new URLSearchParams(location.search);
  if (!search.has("mock")) return shot;
  const handT = search.get("handT");
  const cam = search.get("shotcam");
  if (handT !== null) shot.handT = Number(handT);
  if (cam) shot.cam = cam.split(",").map(Number);
  (window as unknown as { __handShot?: ShotParams }).__handShot = shot;
  return shot;
}
const NO_SHOT: ShotParams = { handT: null, cam: null };
function currentShot(): ShotParams {
  return (
    (window as unknown as { __handShot?: ShotParams }).__handShot ?? NO_SHOT
  );
}

function badgeTexture(number: number, colour: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required for hand badges");
  context.beginPath();
  context.arc(64, 64, 56, 0, Math.PI * 2);
  context.fillStyle = "rgba(12, 9, 6, 0.82)";
  context.fill();
  context.beginPath();
  context.arc(64, 64, 52, 0, Math.PI * 2);
  context.lineWidth = 9;
  context.strokeStyle = colour;
  context.stroke();
  context.font = "600 68px 'Iowan Old Style', Georgia, serif";
  context.fillStyle = "#f4ead6";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number), 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * 2 つの手。モデルは WebXR の標準の手（generic-hand、MIT）。React の木は静的で、
 * アニメーションはすべて共有の MIDI の時計（playhead）を useFrame の中で読んで行う。
 */
export function Hands() {
  return (
    <Suspense fallback={null}>
      <HandsScene />
    </Suspense>
  );
}

function HandsScene() {
  const right = useLoader(GLTFLoader, MODEL_URL.right);
  const left = useLoader(GLTFLoader, MODEL_URL.left);
  const camera = useThree((state) => state.camera);
  useMemo(shotParams, []);

  const parts = useMemo(() => {
    const result = {} as Record<Hand, { rig: HandRig; look: HandMaterial }>;
    for (const [hand, gltf] of [
      ["right", right],
      ["left", left],
    ] as const) {
      const rig = new HandRig(gltf.scene, hand);
      const look = createHandMaterial();
      for (const mesh of rig.meshes) {
        const map = rig.buildSkinFingerMap(mesh);
        mesh.geometry = mesh.geometry.clone();
        mesh.geometry.setAttribute(
          "aFinger",
          new THREE.BufferAttribute(map.finger, 1),
        );
        mesh.geometry.setAttribute(
          "aTip",
          new THREE.BufferAttribute(map.tipness, 1),
        );
        mesh.material = look.material;
        mesh.renderOrder = 2;
      }
      rig.sleeve.material = look.sleeve;
      rig.sleeve.renderOrder = 2;
      result[hand] = { rig, look };
    }
    return result;
  }, [right, left]);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("mock"))
      (window as unknown as { __handParts?: unknown }).__handParts = parts;
  }, [parts]);

  useEffect(
    () => () => {
      for (const hand of HANDS) {
        parts[hand].look.material.dispose();
        parts[hand].look.sleeve.dispose();
        for (const mesh of parts[hand].rig.meshes) mesh.geometry.dispose();
      }
    },
    [parts],
  );

  const trailRef = useRef<THREE.InstancedMesh>(null);
  const guideRef = useRef<THREE.BufferGeometry>(null);
  const rootRef = useRef<THREE.Group>(null);
  const badgeRefs = useRef<Array<THREE.Sprite | null>>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const guidePositions = useMemo(
    () => new Float32Array(HANDS.length * GUIDE_SEGMENTS * 2 * 3),
    [],
  );
  const guideColours = useMemo(
    () => new Float32Array(HANDS.length * GUIDE_SEGMENTS * 2 * 3),
    [],
  );
  const fingerColours = useMemo(
    () => FINGER_COLOURS.map((value) => new THREE.Color(value)),
    [],
  );
  const textures = useMemo(
    () => FINGER_COLOURS.map((value, index) => badgeTexture(index + 1, value)),
    [],
  );
  useEffect(
    () => () => textures.forEach((texture) => texture.dispose()),
    [textures],
  );

  // 撮影用のカメラ固定。CameraRig（既定の優先度 0）のあとに上書きする
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const cam = currentShot().cam;
    if (!cam || cam.length < 6) return;
    camera.position.set(cam[0], cam[1], cam[2]);
    camTarget.set(cam[3], cam[4], cam[5]);
    camera.lookAt(camTarget);
  }, 0.5);

  useFrame(() => {
    const snapshot = useAppStore.getState() as unknown as HandsStoreSnapshot;
    const mode = snapshot.handsMode ?? "hidden";
    const root = rootRef.current;
    if (!root) return;
    root.visible = mode !== "hidden";
    if (mode === "hidden") return;
    const timeline = snapshot.timeline ?? null;
    const fingers = snapshot.fingers ?? {};
    const lead =
      mode === "ghost" && timeline ? 30000 / Math.max(1, timeline.bpm) : 0;
    const playhead = (currentShot().handT ?? getPlayheadMs()) + lead;
    const opacity = mode === "demo" ? 0.95 : 0.3;
    const trails = trailRef.current;
    if (!trails) return;

    let trailIndex = 0;
    for (let handIndex = 0; handIndex < HANDS.length; handIndex++) {
      const hand = HANDS[handIndex];
      const { rig, look } = parts[hand];
      const pose = computeHandPose(timeline, fingers, hand, playhead);
      // 使わない手は、鍵盤の外（手前の下）へ下げて薄く表示する
      const parked = !pose.active;
      const offset = parked
        ? v3(hand === "right" ? 0.27 : -0.27, -0.05, 0.14)
        : v3(0, 0, 0);
      const dim = parked ? 0.45 : 1;
      look.setOpacity(opacity * dim);
      for (const mesh of rig.meshes)
        mesh.castShadow = mode === "demo" && !parked;
      rig.update(pose, offset);

      // 次に打鍵する指だけ、指の色でうっすら光らせる。打鍵が近づくほど少し強くする
      for (const glow of look.glow) glow.set(0, 0, 0);
      let nextFinger = 0;
      if (pose.next && !parked) {
        nextFinger = pose.next.finger;
        const near =
          1 - Math.min(1, Math.max(0, (pose.next.startMs - playhead) / 700));
        const c = fingerColours[nextFinger - 1];
        look.glow[nextFinger]
          .set(c.r, c.g, c.b)
          .multiplyScalar(GLOW_STRENGTH * (0.45 + 0.55 * near));
      }

      updateGuide(
        handIndex,
        pose,
        offset,
        guidePositions,
        guideColours,
        dim,
        fingerColours,
      );
      for (
        let fingerIndex = 0;
        fingerIndex < pose.fingers.length;
        fingerIndex++
      ) {
        const finger = pose.fingers[fingerIndex];
        const badge = badgeRefs.current[handIndex * 5 + fingerIndex];
        if (badge) {
          const isNext = nextFinger === finger.finger;
          badge.visible = isNext;
          if (isNext)
            badge.position.set(
              finger.tip.x + offset.x,
              finger.tip.y + offset.y + 0.058,
              finger.tip.z + offset.z,
            );
        }
      }
      // 親指くぐり・指越えの残像（トレイル）
      const trailFinger = pose.fingers.find((finger) => finger.crossing);
      for (let dot = 0; dot < TRAIL_DOTS; dot++) {
        if (trailFinger && !parked) {
          const ahead = dot / (TRAIL_DOTS - 1);
          const direction = trailFinger.crossing === "thumb_under" ? -1 : 1;
          dummy.position.set(
            trailFinger.tip.x + direction * ahead * 0.095,
            trailFinger.tip.y + ahead * 0.017 + 0.004,
            trailFinger.tip.z + ahead * 0.034,
          );
          dummy.scale.setScalar(0.0045 * (1 - ahead * 0.7));
          colour
            .copy(fingerColours[trailFinger.finger - 1])
            .multiplyScalar(0.8 * (1 - ahead * 0.7));
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.setScalar(0.001);
          colour.set("#000000");
        }
        dummy.updateMatrix();
        trails.setMatrixAt(trailIndex, dummy.matrix);
        trails.setColorAt(trailIndex++, colour);
      }
    }
    trails.instanceMatrix.needsUpdate = true;
    if (trails.instanceColor) trails.instanceColor.needsUpdate = true;
    const geometry = guideRef.current;
    if (geometry) {
      (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate =
        true;
      (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate =
        true;
    }
  });

  return (
    <group ref={rootRef}>
      {HANDS.map((hand) => (
        <primitive key={hand} object={parts[hand].rig.root} />
      ))}
      <instancedMesh
        ref={trailRef}
        args={[undefined, undefined, HANDS.length * TRAIL_DOTS]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <lineSegments frustumCulled={false}>
        <bufferGeometry ref={guideRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[guidePositions, 3]}
            usage={THREE.DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[guideColours, 3]}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      {HANDS.flatMap((_, handIndex) =>
        FINGER_COLOURS.map((_, fingerIndex) => (
          <sprite
            key={`${handIndex}-${fingerIndex}`}
            ref={(node) => {
              badgeRefs.current[handIndex * 5 + fingerIndex] = node;
            }}
            renderOrder={5}
            scale={[0.024, 0.024, 1]}
          >
            <spriteMaterial
              map={textures[fingerIndex]}
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        )),
      )}
    </group>
  );
}

function updateGuide(
  handIndex: number,
  pose: HandPose,
  offset: Vec3,
  positions: Float32Array,
  colours: Float32Array,
  dim: number,
  fingerColours: readonly THREE.Color[],
) {
  const base = handIndex * GUIDE_SEGMENTS * 2 * 3;
  const finger = pose.next ? pose.fingers[pose.next.finger - 1] : null;
  const target = pose.next ? keyTouchPoint(pose.next.pitch) : null;
  const tint = finger ? fingerColours[finger.finger - 1] : null;
  const span =
    finger && target
      ? Math.hypot(
          target[0] - finger.tip.x,
          target[1] - finger.tip.y,
          target[2] - finger.tip.z,
        )
      : 0;
  for (let segment = 0; segment < GUIDE_SEGMENTS; segment++) {
    const a = segment / GUIDE_SEGMENTS;
    const b = (segment + 1) / GUIDE_SEGMENTS;
    for (const [point, t] of [
      [0, a],
      [1, b],
    ] as const) {
      const index = base + (segment * 2 + point) * 3;
      if (!finger || !target || !pose.active || span < 0.03) {
        positions[index] = 0;
        positions[index + 1] = -10;
        positions[index + 2] = 0;
      } else {
        const arc = Math.sin(Math.PI * t) * 0.025;
        positions[index] =
          finger.tip.x + (target[0] - finger.tip.x) * t + offset.x;
        positions[index + 1] =
          finger.tip.y + (target[1] - finger.tip.y) * t + arc + offset.y;
        positions[index + 2] =
          finger.tip.z + (target[2] - finger.tip.z) * t + offset.z;
      }
      // 端へ向けて消える
      const fade = (1 - t) * dim;
      colours[index] = tint ? tint.r * fade : 0;
      colours[index + 1] = tint ? tint.g * fade : 0;
      colours[index + 2] = tint ? tint.b * fade : 0;
    }
  }
}
