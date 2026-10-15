import { Vector3 } from "three";

/**
 * 3 節の指（付け根 → 第 1 関節 → 第 2 関節 → 指先）を、1 つの平面の中で曲げる解析的な IK。
 *
 * 平面は「付け根 → 目標」と「極ベクトル（pole、曲げの上側）」で決まる。平面の中の節の向きは、
 * 目標の方向を 0 として、極の側を正にとった角度 a_i = α − c_i で表す。
 * c_i は曲げの累積（c1 = 0、c2 = θ、c3 = θ + kθ。k は先端の関節が第 2 関節に連動する割合）。
 * 指先が目標の線の上に載る条件から α は一意に決まり、先端までの距離は θ の単調減少関数になるので、
 * θ を二分法で求める。人の指のアーチ（付け根が高く、指先に向けて曲がり降りる形）になる。
 */

const PLANE_U = new Vector3();
const PLANE_V = new Vector3();

/** θ のときの、付け根から指先までの距離と、第 1 節の傾き α。 */
export function chainReach(
  l1: number,
  l2: number,
  l3: number,
  coupling: number,
  theta: number,
): { distance: number; alpha: number } {
  const c3 = theta * (1 + coupling);
  const sc = l1 + l2 * Math.cos(theta) + l3 * Math.cos(c3);
  const ss = l2 * Math.sin(theta) + l3 * Math.sin(c3);
  return { distance: Math.hypot(sc, ss), alpha: Math.atan2(ss, sc) };
}

/** 曲げの上限（人の指の第 2 関節は約 110 度まで曲がる）。 */
export const MAX_THETA = 1.9;

/**
 * 付け根 root から目標 target へ届く 4 つの関節の位置を out に書く（out[0] = root、out[3] = 指先）。
 * 届かないときは、目標の方向へまっすぐ伸ばす（骨の長さは必ず保つ）。
 * normalOut を渡すと、曲げの平面の法線（u × v）を書き込む。
 * 戻り値は、指先と目標の距離（届いたとき 0）。
 */
export function solveChain(
  root: Vector3,
  target: Vector3,
  lengths: readonly [number, number, number],
  pole: Vector3,
  coupling: number,
  out: readonly [Vector3, Vector3, Vector3, Vector3],
  normalOut?: Vector3,
): number {
  const [l1, l2, l3] = lengths;
  PLANE_U.subVectors(target, root);
  const wanted = PLANE_U.length();
  if (wanted < 1e-9) PLANE_U.set(0, -1, 0);
  else PLANE_U.multiplyScalar(1 / wanted);
  // 極を、目標の方向に垂直にした方向 v（平面の「上」）
  PLANE_V.copy(pole).addScaledVector(PLANE_U, -pole.dot(PLANE_U));
  if (PLANE_V.lengthSq() < 1e-10) {
    PLANE_V.set(0, 1, 0).addScaledVector(PLANE_U, -PLANE_U.y);
    if (PLANE_V.lengthSq() < 1e-10) PLANE_V.set(1, 0, 0);
  }
  PLANE_V.normalize();
  // 平面の法線（節の「背」の向きを、平面の中で決めるのに使う）
  if (normalOut) normalOut.crossVectors(PLANE_U, PLANE_V);

  const max = chainReach(l1, l2, l3, coupling, 0).distance;
  let theta = 0;
  if (wanted < max) {
    const min = chainReach(l1, l2, l3, coupling, MAX_THETA).distance;
    if (wanted <= min) theta = MAX_THETA;
    else {
      let lo = 0;
      let hi = MAX_THETA;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (chainReach(l1, l2, l3, coupling, mid).distance > wanted) lo = mid;
        else hi = mid;
      }
      theta = (lo + hi) / 2;
    }
  }
  const { alpha } = chainReach(l1, l2, l3, coupling, theta);
  const angles = [alpha, alpha - theta, alpha - theta * (1 + coupling)];
  out[0].copy(root);
  for (let i = 0; i < 3; i++) {
    const len = lengths[i];
    out[i + 1]
      .copy(out[i])
      .addScaledVector(PLANE_U, Math.cos(angles[i]) * len)
      .addScaledVector(PLANE_V, Math.sin(angles[i]) * len);
  }
  return out[3].distanceTo(target);
}
