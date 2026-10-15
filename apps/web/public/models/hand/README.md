# 手の 3D モデル（left.glb / right.glb）

## 出典
- **WebXR Input Profiles** の generic-hand（`@webxr-input-profiles/assets`）
- リポジトリ: https://github.com/immersive-web/webxr-input-profiles （`packages/assets/profiles/generic-hand/`）
- ライセンス: **MIT**（Copyright (c) 2019 Amazon）。全文は同じフォルダの `LICENSE-webxr-input-profiles.md`
- 商用利用・再配布・改変が可能。著作権表示と許諾表示を残す条件を、このフォルダのファイルで満たしている。
- ファイルは改変せず、そのまま同梱している（実行時に外部へアクセスしない。`public/` から配信する）。

## 中身
- WebXR の標準の手の骨格（wrist、thumb-metacarpal / -phalanx-proximal / -phalanx-distal / -tip、
  index / middle / ring / pinky-finger-metacarpal / -phalanx-proximal / -intermediate / -phalanx-distal / -tip）を持つ
  スキンメッシュ 1 つ（約 1,360 頂点、テクスチャなし）。実寸の約 0.9 倍の大人の手。
- 骨はすべて Armature 直下の兄弟で、ワールドの位置と向きが入っている（階層は付いていない）。

## このアプリでの使い方
- `apps/web/src/hands/rig.ts`（`HandRig`）が読み込み、骨を 手首 → 中手骨 → 基節 → … の親子へ付け替える
  （ワールドの位置と向きは保つ）。
- `apps/web/src/hands/pose.ts` が時刻から、手首の位置と各指の指先の目標を決める。
  `HandRig.update` が、指ごとに 3 節の IK（`hands/ik.ts`、平面の解析解 + 二分法）を解き、
  節の向きを親のローカル座標へ変換して書き込む。骨の長さは保たれる。
- 見た目（象牙〜パールの質感）は `apps/web/src/hands/handMaterial.ts`、描画は `apps/web/src/scene/Hands.tsx`。
- 手首の切り口を隠すため、手首に暗い袖（円筒）を付けている（モデルの一部ではなく、コードで生成する）。
