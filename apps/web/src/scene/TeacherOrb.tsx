import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Mesh, ShaderMaterial } from "three";
import { useAppStore } from "../state/store";

const vertexShader = `varying vec3 vNormal; varying vec3 vPos; void main(){ vNormal=normalize(normalMatrix*normal); vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const fragmentShader = `uniform float uTime; uniform float uLevel; varying vec3 vNormal; varying vec3 vPos; void main(){ float fres=pow(1.0-abs(dot(normalize(vNormal),vec3(0.,0.,1.))),2.4); float noise=sin(vPos.x*18.+uTime*3.)*sin(vPos.y*14.-uTime*2.)*.12; vec3 core=mix(vec3(.34,.21,.06),vec3(1.,.8,.4),fres+noise+uLevel*.3); gl_FragColor=vec4(core, .78+fres*.22); }`;

export function TeacherOrb() {
  const mesh = useRef<Mesh>(null);
  const level = useAppStore((state) => state.voiceLevel);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
      }),
    [],
  );

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLevel.value +=
      (level - material.uniforms.uLevel.value) * 0.16;
    const scale =
      1 +
      material.uniforms.uLevel.value * 0.22 +
      Math.sin(clock.elapsedTime * 2.4) * 0.018;
    mesh.current.scale.setScalar(scale);
  });

  return (
    <group position={[-0.34, 0.3, -0.75]}>
      <mesh ref={mesh} material={material}>
        <sphereGeometry args={[0.035, 48, 32]} />
      </mesh>
      {/* 字幕は画面上部（Hud）に一本化する。ここにも出すと二重に表示される */}
    </group>
  );
}
