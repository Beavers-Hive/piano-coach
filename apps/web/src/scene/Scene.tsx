import {
  Environment,
  Lightformer,
  MeshReflectorMaterial,
} from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Vignette,
} from "@react-three/postprocessing";
import { ACESFilmicToneMapping, Vector2 } from "three";
import { CameraRig } from "./CameraRig";
import { Hands } from "./Hands";
import { HitEffects } from "./HitEffects";
import { Keyboard } from "./Keyboard";
import { FallingNotes, Highway } from "./Notes";
import { ScorePages } from "./ScorePages";
import { TeacherOrb } from "./TeacherOrb";

export function PianoScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.72, 1.18], fov: 38 }}
      gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
    >
      <color attach="background" args={["#03050d"]} />
      <fog attach="fog" args={["#03050d", 0.9, 2.4]} />
      <ambientLight intensity={0.15} />
      <spotLight
        position={[0, 1.2, 0.5]}
        intensity={9}
        angle={0.5}
        penumbra={1}
        castShadow
        color="#a8e9ff"
      />
      <pointLight
        position={[-0.72, 0.24, 0.15]}
        intensity={4}
        color="#964dff"
      />
      <Keyboard />
      <Highway />
      <FallingNotes />
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
          color="#060a17"
          metalness={0.78}
        />
      </mesh>
      <Environment resolution={128}>
        <Lightformer
          form="rect"
          intensity={3}
          color="#9ce5ff"
          position={[0, 1.8, 1]}
          scale={[2.5, 1.3, 1]}
        />
        <Lightformer
          form="ring"
          intensity={2}
          color="#7d55ff"
          position={[-1.4, 0.4, 0]}
          rotation-y={Math.PI / 2}
          scale={[1.5, 1.5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#ff4f98"
          position={[1, 0.2, -0.9]}
          rotation-y={-Math.PI / 3}
          scale={[1.2, 1.2, 1]}
        />
      </Environment>
      <CameraRig />
      <EffectComposer>
        <Bloom
          intensity={1.1}
          luminanceThreshold={0.9}
          luminanceSmoothing={0.15}
          mipmapBlur
        />
        <ChromaticAberration offset={new Vector2(0.0004, 0.0004)} />
        <Vignette eskil={false} offset={0.16} darkness={0.78} />
      </EffectComposer>
    </Canvas>
  );
}
