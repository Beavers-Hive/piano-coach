import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getPlayheadMs } from "../midi/clock";
import { useAppStore } from "../state/store";
import type { TimelineNote } from "../types";
import { KEY, KEYBOARD_EXTENT, isBlack, keyX } from "./keyboardLayout";

export const FINGER_COLOURS = [
  "#ff4b5e",
  "#ff9b32",
  "#ffe85c",
  "#69e8a3",
  "#58adff",
];
const HAND_COLOURS = { right: "#2de8ff", left: "#ff55db" } as const;

// ノーツは鍵盤の奥から、ゆるい上り坂（奥ほど高い）のハイウェイを下ってきて、
// 鍵盤の奥の縁（赤いフェルトの位置）にある判定ラインで鍵盤に吸い込まれる。
export const HIGHWAY_LENGTH = 1.1;
const APPROACH_MS = 3200;
const RAMP = Math.tan((7 * Math.PI) / 180);
export const HIT_Z = KEYBOARD_EXTENT.backZ - 0.004;
const BASE_Y = KEY.whiteHeight + KEY.blackHeight + 0.006;
const NOTE_HEIGHT = 0.012;
const GLOW = 1.8; // Bloom で光らせるための倍率（toneMapped=false の色に掛ける）

/** ハイウェイ上の距離（判定ラインからの奥行き）→ 座標。 */
function highwayPoint(distance: number): { y: number; z: number } {
  return { y: BASE_Y + distance * RAMP, z: HIT_Z - distance };
}

function msToDistance(ms: number): number {
  return (ms / APPROACH_MS) * HIGHWAY_LENGTH;
}

function noteColour(note: TimelineNote, finger?: number): string {
  if (finger) return FINGER_COLOURS[finger - 1];
  return HAND_COLOURS[note.hand];
}

export function FallingNotes() {
  const timeline = useAppStore((state) => state.timeline);
  const fingers = useAppStore((state) => state.fingers);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const cores = useRef<THREE.InstancedMesh>(null);
  const [labels, setLabels] = useState<TimelineNote[]>([]);
  const notes = useMemo(() => timeline?.notes ?? [], [timeline]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const white = useMemo(() => new THREE.Color("#ffffff"), []);
  const lastLabelUpdate = useRef(0);

  useEffect(() => {
    if (bodies.current) bodies.current.count = notes.length;
    if (cores.current) cores.current.count = notes.length;
  }, [notes.length]);

  useFrame(({ clock }) => {
    if (!bodies.current || !cores.current) return;
    const playhead = getPlayheadMs();

    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index];
      const finger = fingers[note.sourceNoteId] ?? note.finger;
      // 判定ラインより手前に出た部分は描かない（鍵盤に吸い込まれていく見た目にする）
      const head = Math.max(0, msToDistance(note.startMs - playhead));
      const tail = msToDistance(note.startMs + note.durationMs - playhead);
      const visible = tail > 0 && head < HIGHWAY_LENGTH;
      const length = visible
        ? Math.max(0.012, Math.min(tail, HIGHWAY_LENGTH) - head)
        : 0;
      const mid = highwayPoint(head + length / 2);
      const width = isBlack(note.pitch)
        ? KEY.blackWidth * 0.9
        : KEY.whiteWidth * 0.78;

      dummy.position.set(keyX(note.pitch), mid.y, mid.z);
      // 奥（-z）ほど高い上り坂に沿わせる（x 軸回転 +atan で、奥側が上がる）
      dummy.rotation.set(Math.atan(RAMP), 0, 0);
      dummy.scale.set(visible ? width : 0, NOTE_HEIGHT, length);
      dummy.updateMatrix();
      bodies.current.setMatrixAt(index, dummy.matrix);

      // 芯は少し細く、上に乗せて明るくする
      dummy.position.y += NOTE_HEIGHT * 0.35;
      dummy.scale.set(
        visible ? width * 0.42 : 0,
        NOTE_HEIGHT * 0.5,
        length * 0.96,
      );
      dummy.updateMatrix();
      cores.current.setMatrixAt(index, dummy.matrix);

      // 判定ラインに近づくほど明るくする
      const nearness = THREE.MathUtils.clamp(1 - head / 0.25, 0, 1);
      colour
        .set(noteColour(note, finger))
        .multiplyScalar(GLOW * (0.7 + 0.6 * nearness));
      bodies.current.setColorAt(index, colour);
      colour.copy(white).multiplyScalar(1.2 + nearness * 1.5);
      cores.current.setColorAt(index, colour);
    }
    for (const mesh of [bodies.current, cores.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    if (clock.elapsedTime - lastLabelUpdate.current > 0.08) {
      lastLabelUpdate.current = clock.elapsedTime;
      setLabels(
        notes
          .filter(
            (note) =>
              note.startMs >= playhead - 60 && note.startMs < playhead + 1800,
          )
          .slice(0, 4),
      );
    }
  });

  if (!notes.length) return null;
  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, notes.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={0.92} />
      </instancedMesh>
      <instancedMesh ref={cores} args={[undefined, undefined, notes.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {labels.map((note) => {
        const finger = fingers[note.sourceNoteId] ?? note.finger;
        if (!finger) return null;
        const point = highwayPoint(
          Math.max(0, msToDistance(note.startMs - getPlayheadMs())),
        );
        return (
          <Html
            key={note.playId}
            position={[keyX(note.pitch), point.y + 0.03, point.z]}
            center
            zIndexRange={[20, 0]}
          >
            <span
              className="fingering"
              style={{ background: FINGER_COLOURS[finger - 1] }}
            >
              {finger}
            </span>
          </Html>
        );
      })}
    </group>
  );
}

/** 課題で使う鍵盤の範囲（ハイウェイのレーンを明るくする範囲と、カメラの寄せ先に使う）。 */
export function exerciseRange(notes: TimelineNote[]): {
  minX: number;
  maxX: number;
} | null {
  if (!notes.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const note of notes) {
    const x = keyX(note.pitch);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  return { minX, maxX };
}

export function Highway() {
  const timeline = useAppStore((state) => state.timeline);
  const range = useMemo(() => exerciseRange(timeline?.notes ?? []), [timeline]);
  const lanes = useMemo(
    () =>
      Array.from(
        { length: 53 },
        (_, index) => -KEYBOARD_EXTENT.width / 2 + index * KEY.whiteWidth,
      ),
    [],
  );
  const start = highwayPoint(0);
  const mid = highwayPoint(HIGHWAY_LENGTH / 2);
  // 床とレーン（plane）は -π/2 で水平にしたうえで、奥側が上がるよう +atan だけ起こす
  const tilt = Math.atan(RAMP);

  return (
    <group>
      {/* ハイウェイの床（ほぼ黒。奥に向かって霧に溶ける） */}
      <mesh
        position={[0, mid.y - 0.007, mid.z]}
        rotation={[tilt - Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[KEYBOARD_EXTENT.width, HIGHWAY_LENGTH]} />
        <meshBasicMaterial color="#03050b" />
      </mesh>
      {lanes.map((x) => {
        const active =
          range && x >= range.minX - 0.03 && x <= range.maxX + 0.03;
        return (
          <mesh
            key={x}
            position={[x, mid.y - 0.006, mid.z]}
            rotation={[tilt - Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[0.0007, HIGHWAY_LENGTH]} />
            <meshBasicMaterial
              color={active ? "#7fe6ff" : "#3a5a7a"}
              transparent
              opacity={active ? 0.35 : 0.08}
              toneMapped={false}
            />
          </mesh>
        );
      })}
      {/* 判定ライン */}
      <mesh position={[0, start.y - 0.004, HIT_Z]}>
        <boxGeometry args={[KEYBOARD_EXTENT.width + 0.02, 0.0025, 0.0035]} />
        <meshBasicMaterial
          color={new THREE.Color("#9ff6ff").multiplyScalar(2.2)}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
