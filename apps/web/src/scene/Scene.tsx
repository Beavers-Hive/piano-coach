import {
  Environment,
  Lightformer,
  MeshReflectorMaterial,
} from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useRef } from "react";
import {
  ACESFilmicToneMapping,
  MathUtils,
  type AmbientLight,
  type SpotLight,
} from "three";
import { useAppStore } from "../state/store";
import { useSongIntro } from "../ui/introState";
import { CameraRig } from "./CameraRig";
import { Hands } from "./Hands";
import { HitEffects } from "./HitEffects";
import { Keyboard } from "./Keyboard";
import { FallingNotes, Highway } from "./Notes";
import { ScorePages } from "./ScorePages";
import { TeacherOrb } from "./TeacherOrb";

/** 照明の基準の明るさ。曲の導入（暗転 → 幕が上がる）では、これに 0〜1 の係数を掛ける。 */
const SPOT_INTENSITY = 8.5;
const AMBIENT_INTENSITY = 0.06;
const EXPOSURE = 1.0;

/**
 * 夜のコンサートホール。真上から暖色のスポットライトが鍵盤を照らし、周囲は闇に沈む。
 * 曲の導入のあいだだけ、照明を落としてから少しずつ明るくする。
 */
function StageLights() {
  const phase = useSongIntro((s) => s.phase);
  const spot = useRef<SpotLight>(null);
  const ambient = useRef<AmbientLight>(null);
  const level = useRef(1);
  useFrame(({ gl }, delta) => {
    const target = phase === "dark" ? 0 : 1;
    const rate = phase === "dark" ? 8 : phase === "off" ? 4 : 1.15;
    level.current = MathUtils.damp(level.current, target, rate, delta);
    const lit = Math.max(0, Math.min(1, level.current));
    if (spot.current) spot.current.intensity = SPOT_INTENSITY * lit ** 1.4;
    if (ambient.current) ambient.current.intensity = AMBIENT_INTENSITY * lit;
    gl.toneMappingExposure = EXPOSURE * (0.05 + 0.95 * lit);
  });
  return (
    <>
      <ambientLight
        ref={ambient}
        intensity={AMBIENT_INTENSITY}
        color="#ffe2b8"
      />
      <spotLight
        ref={spot}
        position={[0, 1.25, 0.45]}
        intensity={SPOT_INTENSITY}
        angle={0.36}
        penumbra={1}
        decay={1.6}
        castShadow
        color="#ffe6c4"
      />
      {/* 鍵盤の縁にだけ、ごく弱い暖色の照り返しを置く */}
      <pointLight position={[0, 0.12, 0.55]} intensity={0.15} color="#ffd9a8" />
    </>
  );
}

export function PianoScene() {
  const showNotes = useAppStore((state) => state.viewMode !== "score");
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.72, 1.18], fov: 38 }}
      gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: EXPOSURE }}
    >
      <color attach="background" args={["#0b0a09"]} />
      <fog attach="fog" args={["#0b0a09", 0.9, 2.3]} />
      <StageLights />
      <Keyboard />
      {showNotes && <Highway />}
      {showNotes && <FallingNotes />}
      <HitEffects />
      <ScorePages />
      <Hands />
      <TeacherOrb />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.07, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <MeshReflectorMaterial
          blur={[200, 70]}
          resolution={512}
          mixBlur={1}
          mixStrength={18}
          roughness={0.32}
          color="#0b0907"
          metalness={0.78}
        />
      </mesh>
      <Environment resolution={128} environmentIntensity={0.3}>
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#ffd9a8"
          position={[0, 1.8, 1]}
          scale={[2.5, 1.3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.5}
          color="#ffe9cf"
          position={[-1.4, 0.4, 0]}
          rotation-y={Math.PI / 2}
          scale={[1.5, 1.5, 1]}
        />
      </Environment>
      <CameraRig />
      <EffectComposer>
        {/* Bloom は控えめに。ノーツと判定ラインのような、色が 1 を超えるものだけが光る */}
        <Bloom
          intensity={0.55}
          luminanceThreshold={1}
          luminanceSmoothing={0.1}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.12} darkness={0.9} />
      </EffectComposer>
    </Canvas>
  );
}
