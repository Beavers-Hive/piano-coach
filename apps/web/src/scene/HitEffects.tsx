import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useAppStore } from "../state/store";
import { keyTopY, keyX } from "./keyboardLayout";

const particleVertex = `attribute vec3 velocity; attribute float delay; uniform float uAge; varying float vLife; void main(){ float age=max(0.,uAge-delay); vLife=clamp(1.-age/.58,0.,1.); vec3 p=position+velocity*age+vec3(0.,-2.2*age*age,0.); gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); gl_PointSize=7.*vLife; }`;
const particleFragment = `varying float vLife; uniform vec3 uColor; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(uColor,(1.-smoothstep(.1,.5,d))*vLife); }`;
const ringVertex = `uniform float uAge; varying float vLife; void main(){ vLife=clamp(1.-uAge/.45,0.,1.); vec3 p=position*(1.+uAge*4.); gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`;
const ringFragment = `varying float vLife; uniform vec3 uColor; void main(){ gl_FragColor=vec4(uColor,vLife*.8); }`;

export function HitEffects() {
  const hit = useAppStore((state) => state.hit);
  const pointMaterial = useRef<THREE.ShaderMaterial>(null);
  const ringMaterial = useRef<THREE.ShaderMaterial>(null);
  const group = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const count = 52;
    const velocity = new Float32Array(count * 3);
    const delay = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const speed = 0.06 + (index % 7) * 0.012;
      velocity.set(
        [
          Math.cos(angle) * speed,
          0.22 + (index % 5) * 0.05,
          Math.sin(angle) * speed,
        ],
        index * 3,
      );
      delay[index] = (index % 9) * 0.012;
    }
    const value = new THREE.BufferGeometry();
    value.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    value.setAttribute("velocity", new THREE.BufferAttribute(velocity, 3));
    value.setAttribute("delay", new THREE.BufferAttribute(delay, 1));
    return value;
  }, []);
  const start = useRef(0);

  useEffect(() => {
    if (!hit) return;
    start.current = performance.now() / 1000;
    group.current?.position.set(
      keyX(hit.pitch),
      keyTopY(hit.pitch) + 0.016,
      0.04,
    );
    const colour = new THREE.Color(
      hit.kind === "perfect" ? "#c8fcff" : "#78aaff",
    );
    pointMaterial.current?.uniforms.uColor.value.copy(colour);
    ringMaterial.current?.uniforms.uColor.value.copy(colour);
  }, [hit]);

  useFrame(({ clock }) => {
    const age = Math.max(0, clock.elapsedTime - start.current);
    if (pointMaterial.current) pointMaterial.current.uniforms.uAge.value = age;
    if (ringMaterial.current) ringMaterial.current.uniforms.uAge.value = age;
  });

  return (
    <group ref={group}>
      <points geometry={geometry}>
        <shaderMaterial
          ref={pointMaterial}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={particleVertex}
          fragmentShader={particleFragment}
          uniforms={{
            uAge: { value: 10 },
            uColor: { value: new THREE.Color("#c8fcff") },
          }}
        />
      </points>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.008, 0.013, 48]} />
        <shaderMaterial
          ref={ringMaterial}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={ringVertex}
          fragmentShader={ringFragment}
          uniforms={{
            uAge: { value: 10 },
            uColor: { value: new THREE.Color("#c8fcff") },
          }}
        />
      </mesh>
    </group>
  );
}
