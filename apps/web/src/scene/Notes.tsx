import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getPlayheadMs } from "../midi/clock";
import { useAppStore } from "../state/store";
import type { TimelineNote } from "../types";
import { KEY, KEYBOARD_EXTENT, isBlack, keyTopY, keyX } from "./keyboardLayout";

const FINGER_COLOURS = ["#ff4b5e", "#ff9b32", "#ffe85c", "#69e8a3", "#58adff"];
const HIGHWAY_LENGTH = 1.2;
const APPROACH_MS = 3400;

function noteColour(note: TimelineNote): string {
  return note.finger
    ? FINGER_COLOURS[note.finger - 1]
    : note.hand === "right"
      ? "#2de8ff"
      : "#ff55db";
}

function noteZ(startMs: number, playheadMs: number): number {
  const progress = (startMs - playheadMs) / APPROACH_MS;
  return KEYBOARD_EXTENT.frontZ + 0.014 - progress * HIGHWAY_LENGTH;
}

export function FallingNotes() {
  const timeline = useAppStore((state) => state.timeline);
  const fingers = useAppStore((state) => state.fingers);
  const instance = useRef<THREE.InstancedMesh>(null);
  const [labels, setLabels] = useState<TimelineNote[]>([]);
  const notes = useMemo(() => timeline?.notes ?? [], [timeline]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const lastLabelUpdate = useRef(0);

  useEffect(() => {
    if (instance.current) instance.current.count = notes.length;
  }, [notes.length]);

  useFrame(({ clock }) => {
    if (!instance.current) return;
    const playhead = getPlayheadMs();
    for (let index = 0; index < notes.length; index += 1) {
      const source = notes[index];
      const note = {
        ...source,
        finger: fingers[source.sourceNoteId] ?? source.finger,
      };
      const black = isBlack(note.pitch);
      const duration = Math.max(
        0.045,
        (note.durationMs / APPROACH_MS) * HIGHWAY_LENGTH,
      );
      dummy.position.set(
        keyX(note.pitch),
        keyTopY(note.pitch) + 0.026,
        noteZ(note.startMs, playhead) - duration / 2,
      );
      dummy.scale.set(
        black ? KEY.blackWidth * 0.86 : KEY.whiteWidth * 0.72,
        0.014,
        duration,
      );
      dummy.updateMatrix();
      instance.current.setMatrixAt(index, dummy.matrix);
      colour.set(noteColour(note));
      instance.current.setColorAt(index, colour);
    }
    instance.current.instanceMatrix.needsUpdate = true;
    if (instance.current.instanceColor)
      instance.current.instanceColor.needsUpdate = true;

    if (clock.elapsedTime - lastLabelUpdate.current > 0.08) {
      lastLabelUpdate.current = clock.elapsedTime;
      setLabels(
        notes
          .filter(
            (note) =>
              note.startMs >= playhead - 80 && note.startMs < playhead + 1500,
          )
          .slice(0, 6),
      );
    }
  });

  if (!notes.length) return null;
  return (
    <group>
      <instancedMesh
        ref={instance}
        args={[undefined, undefined, notes.length]}
        castShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          emissive="#ffffff"
          emissiveIntensity={2.5}
          toneMapped={false}
        />
      </instancedMesh>
      {labels.map((note) => {
        const finger = fingers[note.sourceNoteId] ?? note.finger;
        if (!finger) return null;
        return (
          <Html
            key={note.playId}
            position={[
              keyX(note.pitch),
              keyTopY(note.pitch) + 0.065,
              noteZ(note.startMs, getPlayheadMs()),
            ]}
            center
            distanceFactor={1.3}
            transform
            sprite
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

export function Highway() {
  const laneXs = Array.from(
    { length: 52 },
    (_, index) => -KEYBOARD_EXTENT.width / 2 + index * KEY.whiteWidth,
  );
  return (
    <group rotation-x={-0.025}>
      {laneXs.map((x) => (
        <mesh
          key={x}
          position={[x, 0.003, KEYBOARD_EXTENT.frontZ - HIGHWAY_LENGTH / 2]}
          rotation-x={-Math.PI / 2}
        >
          <planeGeometry args={[0.0008, HIGHWAY_LENGTH]} />
          <meshBasicMaterial color="#61d8ff" transparent opacity={0.13} />
        </mesh>
      ))}
      <mesh
        position={[0, KEY.whiteHeight + 0.009, KEYBOARD_EXTENT.frontZ + 0.008]}
      >
        <boxGeometry args={[KEYBOARD_EXTENT.width + 0.025, 0.005, 0.007]} />
        <meshBasicMaterial color="#83f4ff" toneMapped={false} />
      </mesh>
    </group>
  );
}
