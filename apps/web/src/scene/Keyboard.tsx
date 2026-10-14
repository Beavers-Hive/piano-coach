import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useAppStore } from "../state/store";
import {
  HIGHEST_PITCH,
  KEY,
  KEYBOARD_EXTENT,
  LOWEST_PITCH,
  isBlack,
  keyCenterZ,
  keyTopY,
  keyX,
} from "./keyboardLayout";

function PianoKey({ pitch }: { pitch: number }) {
  const keyRef = useRef<THREE.Group>(null);
  const isPressed = useAppStore((state) => state.pressed.has(pitch));
  const hit = useAppStore((state) => state.hit);
  const black = isBlack(pitch);
  const width = black ? KEY.blackWidth : KEY.whiteWidth - KEY.whiteGap;
  const length = black ? KEY.blackLength : KEY.whiteLength - KEY.whiteGap;
  const pivotZ = keyCenterZ(pitch) - length / 2;
  const y =
    keyTopY(pitch) - (black ? KEY.blackHeight / 2 : KEY.whiteHeight / 2);
  const glows = hit?.pitch === pitch && performance.now() - hit.at < 300;

  useFrame((_, delta) => {
    if (!keyRef.current) return;
    const target = isPressed ? -0.065 : 0;
    keyRef.current.rotation.x = THREE.MathUtils.damp(
      keyRef.current.rotation.x,
      target,
      24,
      delta,
    );
  });

  return (
    <group ref={keyRef} position={[keyX(pitch), 0, pivotZ]}>
      <RoundedBox
        args={[width, black ? KEY.blackHeight : KEY.whiteHeight, length]}
        radius={black ? 0.0025 : 0.0015}
        smoothness={3}
        position={[0, y, length / 2]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={
            glows
              ? hit?.kind === "miss"
                ? "#ff1839"
                : "#d7feff"
              : black
                ? "#05070d"
                : "#e9e6df"
          }
          roughness={black ? 0.18 : 0.38}
          metalness={black ? 0.52 : 0.08}
          clearcoat={black ? 1 : 0.28}
          sheen={black ? 0 : 0.2}
          emissive={
            glows ? (hit?.kind === "miss" ? "#ff173b" : "#40d7ff") : "#000000"
          }
          emissiveIntensity={glows ? 1.6 : 0}
        />
      </RoundedBox>
    </group>
  );
}

export function Keyboard() {
  return (
    <group>
      <RoundedBox
        args={[KEYBOARD_EXTENT.width + 0.09, 0.06, KEY.whiteLength + 0.14]}
        radius={0.018}
        smoothness={5}
        position={[0, -0.035, -0.012]}
        receiveShadow
      >
        <meshPhysicalMaterial
          color="#060913"
          roughness={0.16}
          metalness={0.8}
          clearcoat={1}
        />
      </RoundedBox>
      <mesh
        position={[0, KEY.whiteHeight + 0.003, KEYBOARD_EXTENT.backZ - 0.012]}
      >
        <boxGeometry args={[KEYBOARD_EXTENT.width, 0.006, 0.014]} />
        <meshStandardMaterial
          color="#790519"
          emissive="#5b0010"
          emissiveIntensity={1.4}
        />
      </mesh>
      {Array.from({ length: HIGHEST_PITCH - LOWEST_PITCH + 1 }, (_, index) => (
        <PianoKey key={index} pitch={LOWEST_PITCH + index} />
      ))}
    </group>
  );
}

export { keyX as pitchX } from "./keyboardLayout";
