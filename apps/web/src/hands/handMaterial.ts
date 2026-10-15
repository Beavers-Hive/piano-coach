import { Color, MeshPhysicalMaterial, Vector3 } from "three";

/**
 * 手の質感。「夜のコンサートホール」の暖色の照明を受けた、しっとりした半透明の象牙〜パール。
 * MeshPhysicalMaterial（sheen、clearcoat）に、縁の発光（フレネル）と、
 * 次に打鍵する指の控えめな発光を onBeforeCompile で足す。
 */
export type HandMaterial = {
  material: MeshPhysicalMaterial;
  /** 手首を覆う袖の材質（暗いウール地。奥へ向かって闇に溶ける）。 */
  sleeve: MeshPhysicalMaterial;
  /** 指（1〜5）ごとの発光の色。添字 0 は使わない。 */
  glow: Vector3[];
  setOpacity(opacity: number): void;
};

export function createHandMaterial(): HandMaterial {
  const material = new MeshPhysicalMaterial({
    color: new Color("#c9bda9"),
    roughness: 0.5,
    metalness: 0,
    sheen: 0.8,
    sheenColor: new Color("#f0d9b5"),
    sheenRoughness: 0.55,
    clearcoat: 0.28,
    clearcoatRoughness: 0.38,
    emissive: new Color("#2a2118"),
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.95,
  });
  const glow = Array.from({ length: 6 }, () => new Vector3());
  const rimColor = new Color("#ffd2a0");

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: glow };
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRim = { value: 0.4 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform vec3 uGlow[6];
        attribute float aFinger;
        attribute float aTip;
        varying vec3 vGlow;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        // 指の番号は頂点ごとに色へ変えてから補間する（番号のまま補間すると、境目で別の指の色が混ざる）
        vGlow = uGlow[int(aFinger + 0.5)] * (0.25 + 0.75 * aTip);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform vec3 uRimColor;
        uniform float uRim;
        varying vec3 vGlow;`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.4);
        outgoingLight += uRimColor * fres * uRim + vGlow;
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "piano-coach-hand-v2";

  // 袖: 手首の関節から奥へ伸びる暗い筒。端は闇に溶ける
  const sleeve = new MeshPhysicalMaterial({
    color: new Color("#0e0b09"),
    roughness: 0.75,
    metalness: 0,
    sheen: 1,
    sheenColor: new Color("#3a2e22"),
    sheenRoughness: 0.6,
    transparent: true,
    opacity: 0.95,
  });
  sleeve.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying float vSleeveV;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vSleeveV = uv.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying float vSleeveV;`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        diffuseColor.a *= 1.0 - smoothstep(0.3, 0.95, vSleeveV);
        if (diffuseColor.a < 0.01) discard;
        #include <opaque_fragment>`,
      );
  };
  sleeve.customProgramCacheKey = () => "piano-coach-sleeve-v1";

  return {
    material,
    sleeve,
    glow,
    setOpacity(opacity: number) {
      material.opacity = opacity;
      sleeve.opacity = Math.min(1, opacity + 0.05);
      // 不透明に近いときは奥行きを書き込み、半透明のゴーストでは書き込まない（重なりが自然に透ける）
      material.depthWrite = opacity > 0.6;
      sleeve.depthWrite = opacity > 0.6;
    },
  };
}
