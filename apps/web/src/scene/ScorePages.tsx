import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useAppStore } from "../state/store";
import type { ScoreModel } from "../types";
import { KEY, keyX } from "./keyboardLayout";
import { FINGER_COLOURS, HIGHWAY_LENGTH, HIT_Z } from "./Notes";

// 楽譜を読み込むときの演出。
// 楽譜ページが鍵盤の奥の空中に浮かび、スキャンの光が走るたびにインク（音符や五線）が光の粒になって剥がれ、
// ハイウェイの奥へ流れ込む。ScoreModel が届くと、粒がハイウェイ上でノーツの形に集まる。
// 課題が始まったら（briefing 以降）1 秒ほどでフェードアウトする。

const SHOW_STATES = new Set(["importing", "analyzing", "hearing", "planning"]);
const MAX_PAGES = 5;
const PAGE_HEIGHT = 0.6; // 紙の縦（m）
const STREAM_COUNT = 5500;
const STREAM_PERIOD = 4; // スキャン 1 周（秒）
const NOTE_PARTICLES = 110;
const MAX_FORMATION_NOTES = 40;
const FORMATION_MEASURES = 3;
const RAMP = Math.tan((7 * Math.PI) / 180); // Notes.tsx のハイウェイの傾斜と同じ
const BASE_Y = KEY.whiteHeight + KEY.blackHeight + 0.006;
const HAND_COLOURS = { right: "#2de8ff", left: "#ff55db" } as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function highwayPoint(distance: number): { y: number; z: number } {
  return { y: BASE_Y + distance * RAMP, z: HIT_Z - distance };
}

// ---------------------------------------------------------------- ページの読み込み

type PageAsset = {
  texture: THREE.Texture;
  aspect: number; // 幅 / 高さ
  ink: Float32Array; // インクのある位置 (u, vTop) の列
};

function loadPage(url: string, anisotropy: number): Promise<PageAsset | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
      const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
      resolve({ texture, aspect, ink: sampleInk(image, aspect) });
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** 画像を縮小して、暗い（インクのある）画素の位置を集める。失敗したら空配列（紙全面から出す）。 */
function sampleInk(image: HTMLImageElement, aspect: number): Float32Array {
  try {
    const width = 420;
    const height = Math.max(1, Math.round(width / aspect));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return new Float32Array(0);
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const points: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const luminance =
          (data[index] * 0.299 +
            data[index + 1] * 0.587 +
            data[index + 2] * 0.114) /
          255;
        if (luminance < 0.72)
          points.push((x + 0.5) / width, (y + 0.5) / height);
      }
    }
    return new Float32Array(points);
  } catch {
    return new Float32Array(0);
  }
}

function usePageAssets(urls: string[]): PageAsset[] {
  const gl = useThree((state) => state.gl);
  const [pages, setPages] = useState<PageAsset[]>([]);
  const key = urls.slice(0, MAX_PAGES).join("|");
  useEffect(() => {
    let cancelled = false;
    const loaded: PageAsset[] = [];
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    void Promise.all(
      key ? key.split("|").map((url) => loadPage(url, anisotropy)) : [],
    ).then((results) => {
      const ok = results.filter((page): page is PageAsset => page !== null);
      loaded.push(...ok);
      if (cancelled) ok.forEach((page) => page.texture.dispose());
      else setPages(ok);
    });
    return () => {
      cancelled = true;
      loaded.forEach((page) => page.texture.dispose());
    };
  }, [key, gl]);
  return pages;
}

// ---------------------------------------------------------------- ページの配置（扇状）

type PageLayout = {
  width: number;
  height: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  matrix: THREE.Matrix4;
  phase: number;
};

function layoutPages(aspects: number[]): PageLayout[] {
  const count = aspects.length;
  return aspects.map((aspect, index) => {
    const centred = index - (count - 1) / 2;
    const height = PAGE_HEIGHT;
    const width = height * aspect;
    // 1 ページ目が手前。奥の紙ほど少し外側に開いて、扇のように重なる
    // position は紙の下辺の中央（扇の支点）。紙はここから上に伸びる
    const position = new THREE.Vector3(
      0.06 + centred * 0.07,
      0.02,
      -1.2 - index * 0.03,
    );
    const rotation = new THREE.Euler(
      -0.1,
      -centred * 0.09,
      -centred * 0.15,
      "YXZ",
    );
    const matrix = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromEuler(rotation),
      new THREE.Vector3(1, 1, 1),
    );
    return { width, height, position, rotation, matrix, phase: index * 1.3 };
  });
}

// ---------------------------------------------------------------- シェーダー

const pageVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const pageFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uVis;
uniform float uFlash;
uniform float uScan;
uniform float uTime;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vec3 tex = texture2D(uMap, vUv).rgb;
  float lum = dot(tex, vec3(0.299, 0.587, 0.114));
  float ink = clamp(1.0 - lum, 0.0, 1.0);
  float yTop = 1.0 - vUv.y;

  // 紙の白は落として、青みを足す
  vec3 col = vec3(0.012, 0.025, 0.05) + tex * vec3(0.26, 0.33, 0.46);

  // スキャンの光と、通り過ぎた後に残るインクの発光
  float beam = exp(-pow((yTop - uScan) / 0.011, 2.0)) * step(uScan, 1.1);
  float behind = step(yTop, uScan) * exp(-(uScan - yTop) * 5.5) * step(uScan, 1.25);
  col += vec3(0.45, 1.1, 1.5) * beam * (0.55 + ink * 2.2);
  col += vec3(0.15, 0.85, 1.4) * ink * behind * 1.4;

  // 縁のうっすらした光
  float dm = min(min(vUv.x * uSize.x, (1.0 - vUv.x) * uSize.x),
                 min(vUv.y * uSize.y, (1.0 - vUv.y) * uSize.y));
  float edge = exp(-dm / 0.0045);
  col += mix(vec3(0.25, 0.85, 1.3), vec3(0.65, 0.4, 1.3), vUv.y) * edge * 1.25;

  // ScoreModel が届いたときの一瞬の発光
  col += (vec3(0.5, 0.85, 1.2) * (0.35 + ink * 1.6) + tex * 0.3) * uFlash * 0.7;

  gl_FragColor = vec4(col, uVis * 0.96);
}`;

const haloFragment = /* glsl */ `
uniform float uVis;
uniform float uFlash;
uniform float uTime;
uniform vec2 uSize;     // 紙の大きさ（m）
uniform vec2 uPlane;    // この板の大きさ（m）
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uPlane;
  vec2 q = abs(p) - uSize * 0.5;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float outside = max(d, 0.0);
  float glow = exp(-outside / 0.010) * 0.55 + exp(-outside / 0.035) * 0.2;
  vec3 colour = mix(vec3(0.2, 0.8, 1.2), vec3(0.6, 0.35, 1.2), clamp(vUv.x * 0.6 + vUv.y * 0.4, 0.0, 1.0));
  float pulse = 0.85 + 0.15 * sin(uTime * 1.3);
  float a = glow * pulse * (1.0 + uFlash * 1.6) * step(0.0, d + 0.0001);
  gl_FragColor = vec4(colour * a, a * uVis);
}`;

const streamVertex = /* glsl */ `
attribute vec3 aEntry;
attribute vec3 aEnd;
attribute vec4 aMeta;   // x: 紙の上での縦位置(上=0) y: 湧く順位 z: 粒の大きさ(m) w: ページ番号
attribute vec3 aColor;
uniform float uTime;
uniform float uIntensity;
uniform float uVis;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float period = ${STREAM_PERIOD.toFixed(1)};
  float lifeSpan = 3.1;
  float pageOffset = aMeta.w * 0.37;
  float age = fract(uTime / period - aMeta.x * 0.78 - pageOffset) * period;
  float s = age / lifeSpan;
  float on = step(aMeta.y, uIntensity) * step(s, 1.0);
  float rnd = fract(aMeta.y * 91.7 + aMeta.x * 13.1);

  vec3 birth = position + vec3(0.0, sin(uTime * 0.7 + aMeta.w * 1.3) * 0.012, 0.0);
  vec3 p;
  if (s < 0.42) {
    float u = s / 0.42;
    float e = u * u * (3.0 - 2.0 * u);
    vec3 ctrl = mix(birth, aEntry, 0.3) + vec3((rnd - 0.5) * 0.12, 0.1 + rnd * 0.08, 0.16);
    p = (1.0 - e) * (1.0 - e) * birth + 2.0 * (1.0 - e) * e * ctrl + e * e * aEntry;
  } else {
    float v = (s - 0.42) / 0.58;
    float e = v * (0.5 + 0.5 * v);
    p = mix(aEntry, aEnd, e);
    p.x += sin(v * 9.0 + rnd * 6.28) * 0.006 * (1.0 - v);
    p.y += sin(v * 6.0 + rnd * 6.28) * 0.004 + 0.012 * (1.0 - v);
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float fadeIn = smoothstep(0.0, 0.05, s);
  float fadeOut = 1.0 - smoothstep(0.86, 1.0, s);
  float hot = 1.0 - smoothstep(0.0, 0.12, s);
  float stream = smoothstep(0.42, 0.6, s);
  vColor = mix(aColor, vec3(1.4, 1.9, 2.3), hot * 0.5) * (1.0 + stream * 0.5);
  vAlpha = fadeIn * fadeOut * uVis * on * (0.75 + 0.25 * stream);
  float size = aMeta.z * (0.5 + 0.5 * fadeIn) * (1.0 + 0.5 * stream) * (1.0 - 0.55 * smoothstep(0.8, 1.0, s));
  gl_PointSize = clamp(size * uPx / max(0.05, -mv.z), 0.0, 26.0) * on;
  gl_Position = on > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const formationVertex = /* glsl */ `
attribute vec3 aTarget;
attribute vec4 aMeta;   // x: 出発の遅れ(秒) y: 乱数 z: 粒の大きさ(m) w: ページ番号
attribute vec3 aColor;
uniform float uTime;
uniform float uGather;  // ScoreModel が届いてからの秒数（届く前は -1）
uniform float uVis;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float travel = 1.7;
  float t = clamp((uGather - aMeta.x) / travel, 0.0, 1.0);
  float on = step(0.0, uGather) * step(0.0001, t);
  float e = t * t * (3.0 - 2.0 * t);
  float rnd = aMeta.y;
  vec3 birth = position + vec3(0.0, sin(uTime * 0.7 + aMeta.w * 1.3) * 0.012, 0.0);
  vec3 ctrl = mix(birth, aTarget, 0.35) + vec3((rnd - 0.5) * 0.2, 0.14 + rnd * 0.1, 0.18);
  vec3 p = (1.0 - e) * (1.0 - e) * birth + 2.0 * (1.0 - e) * e * ctrl + e * e * aTarget;
  float landed = smoothstep(0.85, 1.0, t);
  p += landed * 0.0025 * vec3(sin(uTime * 1.7 + rnd * 40.0), sin(uTime * 2.1 + rnd * 17.0) * 0.6, cos(uTime * 1.3 + rnd * 23.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float twinkle = 0.75 + 0.25 * sin(uTime * 3.0 + rnd * 60.0);
  float hot = (1.0 - smoothstep(0.0, 0.2, t)) * 0.8 + landed * (1.0 - landed) * 2.0;
  vColor = mix(aColor, vec3(1.6, 2.2, 2.6), clamp(hot, 0.0, 1.0));
  vAlpha = smoothstep(0.0, 0.08, t) * uVis * on * mix(1.0, twinkle, landed);
  float size = aMeta.z * mix(1.0, 0.8, landed);
  gl_PointSize = clamp(size * uPx / max(0.05, -mv.z), 0.0, 26.0) * on;
  gl_Position = on > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const laneFragment = /* glsl */ `
uniform float uTime;
uniform float uPower;
uniform float uVis;
varying vec2 vUv;
void main() {
  // ハイウェイの上を、手前（鍵盤）へ向かって流れる光の帯
  float phase = vUv.y * 9.0 + uTime * 0.9;
  float band = pow(0.5 + 0.5 * sin(phase * 6.2831), 5.0);
  float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
  float along = smoothstep(0.0, 0.08, 1.0 - vUv.y) * (0.35 + 0.65 * vUv.y);
  float a = uPower * uVis * edge * along * (0.07 + 0.38 * band);
  gl_FragColor = vec4(vec3(0.25, 0.8, 1.2) * a, a);
}`;

const pointFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  float core = exp(-d2 * 7.0);
  float halo = exp(-d2 * 2.2) * 0.35;
  float a = (core + halo) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

// ---------------------------------------------------------------- 粒の元データ

function inkPoint(
  page: PageAsset | undefined,
  layout: PageLayout,
  random: () => number,
  out: THREE.Vector3,
): number {
  let u = random();
  let vTop = random();
  if (page && page.ink.length >= 2) {
    const index = Math.floor(random() * (page.ink.length / 2)) * 2;
    u = page.ink[index] + (random() - 0.5) * 0.0025;
    vTop = page.ink[index + 1] + (random() - 0.5) * 0.0025;
  }
  out
    .set((u - 0.5) * layout.width, (1 - vTop) * layout.height, 0.004)
    .applyMatrix4(layout.matrix);
  return vTop;
}

type FormationNote = {
  x: number;
  d: number;
  length: number;
  hand: "right" | "left";
};

function formationNotes(score: ScoreModel | undefined): FormationNote[] {
  if (!score || !score.notes.length) return [];
  const measureTicks =
    (score.timeSignature.num * score.ppq * 4) / score.timeSignature.den;
  const span = measureTicks * FORMATION_MEASURES;
  const notes = score.notes
    .filter((note) => note.startTick < span)
    .sort((a, b) => a.startTick - b.startTick)
    .slice(0, MAX_FORMATION_NOTES);
  return notes.map((note) => ({
    x: keyX(note.pitch),
    d: 0.1 + (note.startTick / span) * 0.8,
    length: Math.max(0.03, (note.durationTick / span) * 0.8 * 0.88),
    hand: note.hand,
  }));
}

// ---------------------------------------------------------------- 本体

export function ScorePages() {
  const urls = useAppStore((state) => state.pageImageUrls);
  const score = useAppStore((state) => state.score);
  const assets = usePageAssets(urls);
  const gl = useThree((state) => state.gl);

  const layouts = useMemo(
    () => layoutPages(assets.map((a) => a.aspect)),
    [assets],
  );
  const notes = useMemo(() => formationNotes(score), [score]);

  const pageUniforms = useMemo(
    () =>
      assets.map((asset, index) => ({
        uMap: { value: asset.texture },
        uVis: { value: 0 },
        uFlash: { value: 0 },
        uScan: { value: 2 },
        uTime: { value: 0 },
        uSize: {
          value: new THREE.Vector2(layouts[index].width, layouts[index].height),
        },
      })),
    [assets, layouts],
  );
  const haloUniforms = useMemo(
    () =>
      layouts.map((layout) => ({
        uVis: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(layout.width, layout.height) },
        uPlane: {
          value: new THREE.Vector2(layout.width + 0.24, layout.height + 0.24),
        },
      })),
    [layouts],
  );

  // 流れ込む粒（ページから湧いて、ハイウェイの奥へ入る）
  const stream = useMemo(() => {
    if (!assets.length) return null;
    const random = mulberry32(7);
    const count = STREAM_COUNT;
    const position = new Float32Array(count * 3);
    const entry = new Float32Array(count * 3);
    const end = new Float32Array(count * 3);
    const meta = new Float32Array(count * 4);
    const colour = new Float32Array(count * 3);
    const tmp = new THREE.Vector3();
    const tint = new THREE.Color();
    const white = new THREE.Color("#ffffff");
    const left = keyX(55) - 0.05;
    const right = keyX(79) + 0.05;
    for (let i = 0; i < count; i += 1) {
      const pageIndex = Math.min(
        assets.length - 1,
        Math.floor(Math.pow(random(), 1.3) * assets.length),
      );
      const vTop = inkPoint(assets[pageIndex], layouts[pageIndex], random, tmp);
      position.set([tmp.x, tmp.y, tmp.z], i * 3);
      // 紙の横位置を、鍵盤の使う音域へそのまま写す（ページから漏斗のように集まる）
      const lane =
        (tmp.x - layouts[pageIndex].position.x) /
          (layouts[pageIndex].width || 1) +
        0.5;
      const x =
        left +
        (right - left) * THREE.MathUtils.clamp(lane, 0, 1) +
        (random() - 0.5) * 0.03;
      const far = highwayPoint(0.8 + random() * 0.2);
      const near = highwayPoint(0.04 + random() * 0.06);
      entry.set([x, far.y + 0.01, far.z], i * 3);
      end.set([x + (random() - 0.5) * 0.02, near.y + 0.012, near.z], i * 3);
      meta.set([vTop, random(), 0.0035 + random() * 0.006, pageIndex], i * 4);
      tint
        .set(FINGER_COLOURS[Math.floor(random() * FINGER_COLOURS.length)])
        .lerp(white, 0.18 + random() * 0.2)
        .multiplyScalar(1.1 + random() * 0.6);
      colour.set([tint.r, tint.g, tint.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aEntry", new THREE.BufferAttribute(entry, 3));
    geometry.setAttribute("aEnd", new THREE.BufferAttribute(end, 3));
    geometry.setAttribute("aMeta", new THREE.BufferAttribute(meta, 4));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colour, 3));
    return geometry;
  }, [assets, layouts]);

  // ノーツの形に集まる粒
  const formation = useMemo(() => {
    if (!assets.length || !notes.length) return null;
    const random = mulberry32(21);
    const count = notes.length * NOTE_PARTICLES;
    const position = new Float32Array(count * 3);
    const target = new Float32Array(count * 3);
    const meta = new Float32Array(count * 4);
    const colour = new Float32Array(count * 3);
    const tmp = new THREE.Vector3();
    const tint = new THREE.Color();
    const white = new THREE.Color("#ffffff");
    let i = 0;
    notes.forEach((note, noteIndex) => {
      const width = KEY.whiteWidth * 0.8;
      for (let k = 0; k < NOTE_PARTICLES; k += 1, i += 1) {
        const pageIndex = Math.floor(random() * assets.length);
        inkPoint(assets[pageIndex], layouts[pageIndex], random, tmp);
        position.set([tmp.x, tmp.y, tmp.z], i * 3);
        const d = note.d + random() * note.length;
        const point = highwayPoint(d);
        target.set(
          [
            note.x + (random() - 0.5) * width,
            point.y + 0.008 + random() * 0.006,
            point.z,
          ],
          i * 3,
        );
        meta.set(
          [
            noteIndex * 0.06 + random() * 0.35,
            random(),
            0.0048 + random() * 0.0035,
            pageIndex,
          ],
          i * 4,
        );
        tint
          .set(HAND_COLOURS[note.hand])
          .lerp(white, 0.1 + random() * 0.25)
          .multiplyScalar(2.1);
        colour.set([tint.r, tint.g, tint.b], i * 3);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aTarget", new THREE.BufferAttribute(target, 3));
    geometry.setAttribute("aMeta", new THREE.BufferAttribute(meta, 4));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colour, 3));
    return geometry;
  }, [assets, layouts, notes]);

  const pageMaterials = useMemo(
    () =>
      pageUniforms.map(
        (uniforms) =>
          new THREE.ShaderMaterial({
            vertexShader: pageVertex,
            fragmentShader: pageFragment,
            uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
            toneMapped: false,
            fog: false,
          }),
      ),
    [pageUniforms],
  );
  const haloMaterials = useMemo(
    () =>
      haloUniforms.map(
        (uniforms) =>
          new THREE.ShaderMaterial({
            vertexShader: pageVertex,
            fragmentShader: haloFragment,
            uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            fog: false,
          }),
      ),
    [haloUniforms],
  );
  const laneUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPower: { value: 0 },
      uVis: { value: 0 },
    }),
    [],
  );
  const laneMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pageVertex,
        fragmentShader: laneFragment,
        uniforms: laneUniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
        fog: false,
      }),
    [laneUniforms],
  );
  const lane = useMemo(() => {
    const left = keyX(55) - 0.07;
    const right = keyX(79) + 0.07;
    const mid = highwayPoint(HIGHWAY_LENGTH / 2);
    return { x: (left + right) / 2, width: right - left, y: mid.y, z: mid.z };
  }, []);
  const streamUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uVis: { value: 0 },
      uPx: { value: 800 },
    }),
    [],
  );
  const formationUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uGather: { value: -1 },
      uVis: { value: 0 },
      uPx: { value: 800 },
    }),
    [],
  );
  const pointMaterial = (
    vertexShader: string,
    uniforms: Record<string, { value: unknown }>,
  ) =>
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: pointFragment,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
  const streamMaterial = useMemo(
    () => pointMaterial(streamVertex, streamUniforms),
    [streamUniforms],
  );
  const formationMaterial = useMemo(
    () => pointMaterial(formationVertex, formationUniforms),
    [formationUniforms],
  );

  // 結晶化したノーツの面（粒が集まりきった後に、うっすら浮かぶ）
  const blocks = useRef<THREE.InstancedMesh>(null);
  const blockMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const blockGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => {
    const mesh = blocks.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    notes.forEach((note, index) => {
      const mid = highwayPoint(note.d + note.length / 2);
      dummy.position.set(note.x, mid.y + 0.004, mid.z);
      dummy.rotation.set(-Math.atan(RAMP), 0, 0);
      dummy.scale.set(KEY.whiteWidth * 0.74, 0.008, note.length);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(
        index,
        colour.set(HAND_COLOURS[note.hand]).multiplyScalar(1.5),
      );
    });
    mesh.count = notes.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [notes]);

  const groups = useRef<(THREE.Group | null)[]>([]);
  const root = useRef<THREE.Group>(null);
  const vis = useRef(0);
  const streamPower = useRef(0);
  const flashAt = useRef(-1);
  const gatherAt = useRef(-1);
  const lastScore = useRef<ScoreModel | undefined>(undefined);

  useFrame(({ clock, camera }, delta) => {
    const time = clock.elapsedTime;
    const state = useAppStore.getState();
    const show = SHOW_STATES.has(state.lessonState) && assets.length > 0;
    const streaming =
      state.lessonState === "importing" || state.lessonState === "analyzing";

    // フェード: 出るときは 0.7 秒、消えるときは 1 秒
    const dt = Math.min(delta, 0.1);
    vis.current = THREE.MathUtils.clamp(
      vis.current + (show ? dt / 0.7 : -dt / 1.0),
      0,
      1,
    );
    if (root.current) root.current.visible = vis.current > 0.001;
    if (vis.current <= 0.001) {
      return;
    }

    // ScoreModel が届いた瞬間を検出する
    if (state.score && state.score !== lastScore.current) {
      lastScore.current = state.score;
      flashAt.current = time;
      gatherAt.current = time + 0.35;
    }

    const progress = state.importProgress;
    const target = !streaming
      ? 0
      : progress
        ? 0.3 + 0.7 * THREE.MathUtils.clamp(progress.ratio, 0, 1)
        : state.lessonState === "analyzing"
          ? 0.72
          : 0.45;
    streamPower.current +=
      (target - streamPower.current) * (1 - Math.exp(-dt * 1.6));

    const eased = 1 - Math.pow(1 - vis.current, 3);
    const flash =
      flashAt.current >= 0
        ? Math.exp(-(time - flashAt.current) * 1.9) *
          (time >= flashAt.current ? 1 : 0)
        : 0;
    const px =
      gl.domElement.height /
      (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));
    const gather =
      gatherAt.current >= 0 ? Math.max(0, time - gatherAt.current) : -1;

    layouts.forEach((layout, index) => {
      const group = groups.current[index];
      if (group) {
        const bob = Math.sin(time * 0.7 + layout.phase) * 0.012;
        const sway = Math.sin(time * 0.45 + layout.phase) * 0.012;
        group.position.set(
          layout.position.x,
          layout.position.y + bob - (1 - eased) * 0.07,
          layout.position.z,
        );
        group.rotation.set(
          layout.rotation.x + sway * 0.6,
          layout.rotation.y + sway,
          layout.rotation.z,
          "YXZ",
        );
        group.scale.setScalar(0.92 + 0.08 * eased);
      }
      const uniforms = pageUniforms[index];
      if (uniforms) {
        const offset = index * 0.37;
        const scan = ((((time / STREAM_PERIOD - offset) % 1) + 1) % 1) / 0.78;
        uniforms.uVis.value = vis.current;
        uniforms.uFlash.value = flash;
        uniforms.uTime.value = time;
        uniforms.uScan.value =
          streaming && streamPower.current > 0.05 ? scan : 2;
      }
      const halo = haloUniforms[index];
      if (halo) {
        halo.uVis.value = vis.current;
        halo.uFlash.value = flash;
        halo.uTime.value = time;
      }
    });

    streamUniforms.uTime.value = time;
    streamUniforms.uIntensity.value = streamPower.current;
    streamUniforms.uVis.value = vis.current;
    laneUniforms.uTime.value = time;
    laneUniforms.uPower.value = Math.min(1, streamPower.current * 1.3);
    laneUniforms.uVis.value = vis.current;
    streamUniforms.uPx.value = px;
    formationUniforms.uTime.value = time;
    formationUniforms.uGather.value = gather;
    formationUniforms.uVis.value = vis.current;
    formationUniforms.uPx.value = px;

    if (blockMaterial.current) {
      const settle =
        gather < 0 ? 0 : THREE.MathUtils.clamp((gather - 2.2) / 1.2, 0, 1);
      blockMaterial.current.opacity = settle * 0.5 * vis.current;
    }
  });

  if (!assets.length) return null;
  return (
    <group ref={root} visible={false}>
      {layouts.map((layout, index) => (
        <group
          key={index}
          ref={(node) => {
            groups.current[index] = node;
          }}
        >
          <mesh
            position={[0, layout.height / 2, -0.004]}
            renderOrder={10 + index * 3}
          >
            <planeGeometry args={[layout.width + 0.24, layout.height + 0.24]} />
            <primitive object={haloMaterials[index]} attach="material" />
          </mesh>
          <mesh
            position={[0, layout.height / 2, 0]}
            renderOrder={11 + index * 3}
          >
            <planeGeometry args={[layout.width, layout.height]} />
            <primitive object={pageMaterials[index]} attach="material" />
          </mesh>
        </group>
      ))}
      <mesh
        position={[lane.x, lane.y - 0.0045, lane.z]}
        rotation={[-Math.atan(RAMP) - Math.PI / 2, 0, 0]}
        renderOrder={9}
      >
        <planeGeometry args={[lane.width, HIGHWAY_LENGTH]} />
        <primitive object={laneMaterial} attach="material" />
      </mesh>
      {stream && (
        <points geometry={stream} frustumCulled={false} renderOrder={40}>
          <primitive object={streamMaterial} attach="material" />
        </points>
      )}
      {formation && (
        <points geometry={formation} frustumCulled={false} renderOrder={41}>
          <primitive object={formationMaterial} attach="material" />
        </points>
      )}
      <instancedMesh
        ref={blocks}
        args={[blockGeometry, undefined, MAX_FORMATION_NOTES]}
        frustumCulled={false}
        renderOrder={39}
      >
        <meshBasicMaterial
          ref={blockMaterial}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </instancedMesh>
    </group>
  );
}
