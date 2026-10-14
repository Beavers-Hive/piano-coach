// 鍵盤の寸法と座標の唯一の定義。鍵盤・ノーツ・手はすべてここを参照する（統合担当が管理。変更しないこと）。
// 単位はメートル相当。実物のピアノの寸法に合わせる（白鍵 23.5mm 幅 × 150mm 奥行き）。
// 座標系: x = 鍵盤の左右（低音が負）、y = 上、z = 手前が正。白鍵の手前の縁が z = KEY.whiteLength / 2。

export const LOWEST_PITCH = 21; // A0
export const HIGHEST_PITCH = 108; // C8

export const KEY = {
  whiteWidth: 0.0235,
  whiteGap: 0.0012,
  whiteLength: 0.15,
  whiteHeight: 0.022,
  blackWidth: 0.0137,
  blackLength: 0.095,
  blackHeight: 0.012, // 白鍵の上面からの高さ
  pressDepth: 0.01,
} as const;

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isBlack(pitch: number): boolean {
  return BLACK_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
}

function whiteIndex(pitch: number): number {
  let count = 0;
  for (let p = LOWEST_PITCH; p < pitch; p++) {
    if (!isBlack(p)) count++;
  }
  return count;
}

const WHITE_KEY_COUNT = whiteIndex(HIGHEST_PITCH + 1); // 52
const KEYBOARD_WIDTH = WHITE_KEY_COUNT * KEY.whiteWidth;

/** 鍵の中心の x 座標。黒鍵は左右の白鍵の境目に置く。 */
export function keyX(pitch: number): number {
  const left = -KEYBOARD_WIDTH / 2;
  if (isBlack(pitch)) {
    return left + whiteIndex(pitch) * KEY.whiteWidth;
  }
  return left + (whiteIndex(pitch) + 0.5) * KEY.whiteWidth;
}

/** 鍵の上面の y 座標（押されていない状態）。 */
export function keyTopY(pitch: number): number {
  return isBlack(pitch) ? KEY.whiteHeight + KEY.blackHeight : KEY.whiteHeight;
}

/** 鍵の中心の z 座標。 */
export function keyCenterZ(pitch: number): number {
  return isBlack(pitch) ? -(KEY.whiteLength - KEY.blackLength) / 2 : 0;
}

/** 指が触れる位置（鍵の上面で、手前寄り）。手のアニメーションの目標点に使う。 */
export function keyTouchPoint(pitch: number): [number, number, number] {
  const z = isBlack(pitch)
    ? keyCenterZ(pitch) + KEY.blackLength * 0.3
    : KEY.whiteLength / 2 - 0.03;
  return [keyX(pitch), keyTopY(pitch), z];
}

export const KEYBOARD_EXTENT = {
  width: KEYBOARD_WIDTH,
  frontZ: KEY.whiteLength / 2,
  backZ: -KEY.whiteLength / 2,
} as const;
