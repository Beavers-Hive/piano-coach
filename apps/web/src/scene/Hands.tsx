import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { computeHandPose, type HandPose, type Vec3 } from "../hands/pose";
import { getPlayheadMs } from "../midi/clock";
import { keyTouchPoint } from "./keyboardLayout";
import { useAppStore } from "../state/store";
import type { ExerciseTimeline, Finger, Hand } from "../types";

const FINGER_COLOURS = ["#ff4355", "#ff8a2a", "#ffe64b", "#60e59a", "#55a6ff"];
const HANDS: readonly Hand[] = ["right", "left"];
const SEGMENTS_PER_FINGER = 3;
const JOINTS_PER_FINGER = 4;
const TRAIL_DOTS = 11;
const GUIDE_SEGMENTS = 18;
const UP = new THREE.Vector3(0, 1, 0);

type HandsStoreSnapshot = {
  timeline?: ExerciseTimeline | null;
  fingers?: Record<string, Finger>;
  handsMode?: "hidden" | "demo" | "ghost";
};

const vertexShader = /* glsl */ `
  // instanceColor と instanceMatrix は three.js が自動で宣言する（自前で宣言すると二重定義でコンパイルに失敗する）
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vInstanceColour;
  void main() {
    #ifdef USE_INSTANCING_COLOR
      vInstanceColour = instanceColor;
    #else
      vInstanceColour = vec3(1.0);
    #endif
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = mat3(modelMatrix * instanceMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vInstanceColour;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
  void main() {
    vec3 eye = normalize(cameraPosition - vWorldPosition);
    // 大きさ 0 で隠している節は法線の長さが 0 になる。そのまま normalize すると NaN になり、
    // Bloom を通じて画面全体が黒くなるので、長さを確かめてから正規化する。
    float normalLength = length(vWorldNormal);
    if (normalLength < 1e-6) discard;
    vec3 normal = vWorldNormal / normalLength;
    float fresnel = pow(clamp(1.0 - dot(normal, eye), 0.0, 1.0), 2.3);
    float scan = 0.73 + 0.27 * sin(vWorldPosition.y * 310.0 - uTime * 5.0);
    float shimmer = 0.87 + 0.13 * hash(floor(vWorldPosition * 180.0) + floor(uTime * 9.0));
    // 白鍵の上でも見えるように、本体は濃い青の半透明、縁は明るいシアンで光らせる（通常の合成）
    vec3 deep = vec3(0.02, 0.10, 0.22);
    vec3 cyan = vec3(0.25, 0.9, 1.0);
    vec3 rim = mix(cyan, vInstanceColour, 0.35) * (1.2 + fresnel * 2.6);
    vec3 colour = mix(deep, rim, clamp(fresnel * 1.4, 0.0, 1.0)) * scan * shimmer;
    float alpha = uOpacity * (0.55 + fresnel * 0.45) * (0.85 + 0.15 * scan);
    if (any(isnan(colour)) || isnan(alpha)) discard;
    colour = clamp(colour, 0.0, 8.0);
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
  }
`;

function HologramMaterial({
  materialRef,
}: {
  materialRef: RefObject<THREE.ShaderMaterial | null>;
}) {
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uOpacity: { value: 0.85 } }),
    [],
  );
  return (
    <shaderMaterial
      ref={materialRef}
      uniforms={uniforms}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      transparent
      depthWrite={false}
      blending={THREE.NormalBlending}
      toneMapped={false}
      vertexColors
    />
  );
}

function badgeTexture(number: number, colour: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required for hand badges");
  context.beginPath();
  context.arc(64, 64, 54, 0, Math.PI * 2);
  context.fillStyle = colour;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = "#e8ffff";
  context.stroke();
  context.font = "bold 72px ui-rounded, system-ui, sans-serif";
  context.fillStyle = "#06111b";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number), 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function writeVec(
  target: THREE.Vector3,
  source: Vec3,
  offset: Vec3,
): THREE.Vector3 {
  return target.set(
    source.x + offset.x,
    source.y + offset.y,
    source.z + offset.z,
  );
}

function setBetween(
  mesh: THREE.InstancedMesh,
  index: number,
  start: Vec3,
  end: Vec3,
  radius: number,
  offset: Vec3,
  scratch: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
) {
  writeVec(from, start, offset);
  writeVec(to, end, offset);
  scratch.position.copy(from).add(to).multiplyScalar(0.5);
  const span = scratch.position.distanceTo(from) * 2;
  scratch.quaternion.setFromUnitVectors(UP, to.sub(from).normalize());
  // capsuleGeometry(radius=1, length=1) has a total local height of 3.
  scratch.scale.set(radius, Math.max(0.001, span / 3), radius);
  scratch.updateMatrix();
  mesh.setMatrixAt(index, scratch.matrix);
}

function setPoint(
  mesh: THREE.InstancedMesh,
  index: number,
  point: Vec3,
  radius: number,
  offset: Vec3,
  scratch: THREE.Object3D,
) {
  scratch.position.set(
    point.x + offset.x,
    point.y + offset.y,
    point.z + offset.z,
  );
  scratch.scale.setScalar(radius);
  scratch.quaternion.identity();
  scratch.updateMatrix();
  mesh.setMatrixAt(index, scratch.matrix);
}

/**
 * Two procedural hands, built from a handful of instanced meshes. The React tree remains static;
 * all animation uses the shared MIDI playhead inside useFrame.
 */
export function Hands() {
  const segmentRef = useRef<THREE.InstancedMesh>(null);
  const jointRef = useRef<THREE.InstancedMesh>(null);
  const palmRef = useRef<THREE.InstancedMesh>(null);
  const trailRef = useRef<THREE.InstancedMesh>(null);
  const guideRef = useRef<THREE.BufferGeometry>(null);
  const rootRef = useRef<THREE.Group>(null);
  const badgeRefs = useRef<Array<THREE.Sprite | null>>([]);
  const segmentMaterial = useRef<THREE.ShaderMaterial>(null);
  const jointMaterial = useRef<THREE.ShaderMaterial>(null);
  const palmMaterial = useRef<THREE.ShaderMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const from = useMemo(() => new THREE.Vector3(), []);
  const to = useMemo(() => new THREE.Vector3(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const guidePositions = useMemo(
    () => new Float32Array(HANDS.length * GUIDE_SEGMENTS * 2 * 3),
    [],
  );
  const guideColours = useMemo(
    () => new Float32Array(HANDS.length * GUIDE_SEGMENTS * 2 * 3),
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

  useFrame((state) => {
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
    const playhead = getPlayheadMs() + lead;
    const opacity = mode === "demo" ? 0.85 : 0.3;
    for (const material of [
      segmentMaterial.current,
      jointMaterial.current,
      palmMaterial.current,
    ]) {
      if (material) {
        material.uniforms.uTime.value = state.clock.elapsedTime;
        material.uniforms.uOpacity.value = opacity;
      }
    }
    // 手のひらは指より目立たせない（主役は指の動き）
    if (palmMaterial.current)
      palmMaterial.current.uniforms.uOpacity.value = opacity * 0.28;
    const segments = segmentRef.current;
    const joints = jointRef.current;
    const palms = palmRef.current;
    const trails = trailRef.current;
    if (!segments || !joints || !palms || !trails) return;

    let segmentIndex = 0;
    let jointIndex = 0;
    let trailIndex = 0;
    for (let handIndex = 0; handIndex < HANDS.length; handIndex++) {
      const hand = HANDS[handIndex];
      const pose = computeHandPose(timeline, fingers, hand, playhead);
      // A missing hand is left visibly present but parked below and behind the keys.
      const parked = !pose.active;
      const offset = parked
        ? v3(hand === "right" ? 0.21 : -0.21, -0.19, 0.1)
        : v3(0, 0, 0);
      const dim = parked ? 0.14 : 1;
      dummy.position.set(
        pose.palm.center.x + offset.x,
        pose.palm.center.y + offset.y,
        pose.palm.center.z + offset.z,
      );
      dummy.rotation.set(
        pose.palm.rotation.x,
        pose.palm.rotation.y,
        pose.palm.rotation.z,
      );
      dummy.scale.set(0.085, 0.012, 0.095); // 平たい楕円体の手のひら（幅・厚み・奥行き）
      dummy.updateMatrix();
      palms.setMatrixAt(handIndex, dummy.matrix);
      colour.set("#1f6f99").multiplyScalar(dim * 0.6); // 手のひらは指より控えめに光らせる
      palms.setColorAt(handIndex, colour);

      updateGuide(handIndex, pose, offset, guidePositions, guideColours, dim);
      for (
        let fingerIndex = 0;
        fingerIndex < pose.fingers.length;
        fingerIndex++
      ) {
        const finger = pose.fingers[fingerIndex];
        const fingerColour = FINGER_COLOURS[finger.finger - 1];
        const isNext = pose.next?.finger === finger.finger;
        const brightness = dim * (isNext ? 1.8 : 0.42);
        colour.set(fingerColour).multiplyScalar(brightness);
        for (let bone = 0; bone < SEGMENTS_PER_FINGER; bone++) {
          setBetween(
            segments,
            segmentIndex++,
            finger.joints[bone],
            finger.joints[bone + 1],
            finger.finger === 1 ? 0.008 : 0.007,
            offset,
            dummy,
            from,
            to,
          );
          segments.setColorAt(segmentIndex - 1, colour);
        }
        for (let joint = 0; joint < JOINTS_PER_FINGER; joint++) {
          setPoint(
            joints,
            jointIndex++,
            finger.joints[joint],
            joint === 3 ? 0.01 : 0.0075,
            offset,
            dummy,
          );
          joints.setColorAt(jointIndex - 1, colour);
        }
        const badge = badgeRefs.current[handIndex * 5 + fingerIndex];
        if (badge) {
          badge.visible = Boolean(isNext && !parked);
          if (isNext)
            badge.position.set(
              finger.tip.x + offset.x,
              finger.tip.y + offset.y + 0.065,
              finger.tip.z + offset.z,
            );
        }
      }
      const trailFinger = pose.fingers.find((finger) => finger.crossing);
      for (let dot = 0; dot < TRAIL_DOTS; dot++) {
        if (trailFinger && !parked) {
          const ahead = dot / (TRAIL_DOTS - 1);
          const direction = trailFinger.crossing === "thumb_under" ? -1 : 1;
          const point = v3(
            trailFinger.tip.x + direction * ahead * 0.095,
            trailFinger.tip.y + ahead * 0.017,
            trailFinger.tip.z + ahead * 0.034,
          );
          setPoint(
            trails,
            trailIndex,
            point,
            0.006 * (1 - ahead * 0.7),
            offset,
            dummy,
          );
          colour
            .set(FINGER_COLOURS[trailFinger.finger - 1])
            .multiplyScalar(1 - ahead * 0.65);
        } else {
          setPoint(
            trails,
            trailIndex,
            v3(0, -10, 0),
            0.001,
            v3(0, 0, 0),
            dummy,
          );
          colour.set("#000000");
        }
        trails.setColorAt(trailIndex++, colour);
      }
    }
    segments.instanceMatrix.needsUpdate = true;
    joints.instanceMatrix.needsUpdate = true;
    palms.instanceMatrix.needsUpdate = true;
    trails.instanceMatrix.needsUpdate = true;
    if (segments.instanceColor) segments.instanceColor.needsUpdate = true;
    if (joints.instanceColor) joints.instanceColor.needsUpdate = true;
    if (palms.instanceColor) palms.instanceColor.needsUpdate = true;
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
      <instancedMesh
        ref={palmRef}
        args={[undefined, undefined, 2]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.5, 32, 16]} />
        <HologramMaterial materialRef={palmMaterial} />
      </instancedMesh>
      <instancedMesh
        ref={segmentRef}
        args={[undefined, undefined, HANDS.length * 5 * SEGMENTS_PER_FINGER]}
        frustumCulled={false}
      >
        <capsuleGeometry args={[1, 1, 4, 8]} />
        <HologramMaterial materialRef={segmentMaterial} />
      </instancedMesh>
      <instancedMesh
        ref={jointRef}
        args={[undefined, undefined, HANDS.length * 5 * JOINTS_PER_FINGER]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 10, 8]} />
        <HologramMaterial materialRef={jointMaterial} />
      </instancedMesh>
      <instancedMesh
        ref={trailRef}
        args={[undefined, undefined, HANDS.length * TRAIL_DOTS]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.82}
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
          opacity={0.9}
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
            scale={[0.022, 0.022, 1]}
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

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function updateGuide(
  handIndex: number,
  pose: HandPose,
  offset: Vec3,
  positions: Float32Array,
  colours: Float32Array,
  dim: number,
) {
  const base = handIndex * GUIDE_SEGMENTS * 2 * 3;
  const finger = pose.next ? pose.fingers[pose.next.finger - 1] : null;
  const target = pose.next ? keyTouchPoint(pose.next.pitch) : null;
  const colour = new THREE.Color(
    finger ? FINGER_COLOURS[finger.finger - 1] : "#000000",
  ).multiplyScalar(dim);
  for (let segment = 0; segment < GUIDE_SEGMENTS; segment++) {
    const a = segment / GUIDE_SEGMENTS;
    const b = (segment + 1) / GUIDE_SEGMENTS;
    for (const [point, t] of [
      [0, a],
      [1, b],
    ] as const) {
      const index = base + (segment * 2 + point) * 3;
      if (!finger || !target || !pose.active) {
        positions[index] = 0;
        positions[index + 1] = -10;
        positions[index + 2] = 0;
      } else {
        const u = t;
        const arc = Math.sin(Math.PI * u) * 0.075;
        positions[index] =
          finger.tip.x + (target[0] - finger.tip.x) * u + offset.x;
        positions[index + 1] =
          finger.tip.y + (target[1] - finger.tip.y) * u + arc + offset.y;
        positions[index + 2] =
          finger.tip.z + (target[2] - finger.tip.z) * u + offset.z;
      }
      colours[index] = colour.r;
      colours[index + 1] = colour.g;
      colours[index + 2] = colour.b;
    }
  }
}
