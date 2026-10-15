import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useAppStore } from "../state/store";
import type { CameraPreset } from "../types";
import { KEYBOARD_EXTENT } from "./keyboardLayout";
import { exerciseRange } from "./Notes";

type View = { position: Vector3; target: Vector3 };

/**
 * カメラの構図。play と closeup は、課題で使う音域の中心に寄せ、
 * 音域の幅に合わせて距離を変える（狭い音域ほど寄る）。
 */
function viewFor(preset: CameraPreset, centerX: number, spanX: number): View {
  const span = Math.max(0.3, spanX + 0.18);
  switch (preset) {
    case "play": {
      // 手前の手（手首は鍵盤の前縁より約 13cm 手前）と、奥のハイウェイの両方が収まる構図
      const distance = 0.42 + span * 0.55;
      return {
        position: new Vector3(
          centerX,
          0.22 + distance * 0.78,
          0.3 + distance * 0.62,
        ),
        target: new Vector3(centerX, 0.02, -0.12),
      };
    }
    case "closeup":
      return {
        position: new Vector3(centerX + 0.07, 0.24, 0.42),
        target: new Vector3(centerX, 0.03, 0.06),
      };
    case "score":
      return {
        position: new Vector3(0, 0.62, 1.05),
        target: new Vector3(0, 0.18, -0.4),
      };
    case "overview":
    default:
      return {
        position: new Vector3(0, 0.52, KEYBOARD_EXTENT.width * 0.86),
        target: new Vector3(0, 0.02, -0.3),
      };
  }
}

/** 下部のダイアログが 3D の手やノーツを隠さないよう、描画の中心を画面の高さのこの割合だけ上へずらす。 */
const VIEW_SHIFT_UP = 0.15;

export function CameraRig() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  // 描画を上へ寄せる（ウィンドウのリサイズにも追従する）
  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    camera.setViewOffset(
      size.width,
      size.height,
      0,
      Math.round(size.height * VIEW_SHIFT_UP),
      size.width,
      size.height,
    );
    return () => camera.clearViewOffset();
  }, [camera, size.width, size.height]);

  const preset = useAppStore((state) => state.camera);
  const running = useAppStore((state) => state.running);
  const timeline = useAppStore((state) => state.timeline);
  const range = useMemo(() => exerciseRange(timeline?.notes ?? []), [timeline]);
  const look = useRef(new Vector3(0, 0.02, -0.3));
  const goal = useRef(new Vector3());

  useFrame(({ clock }, delta) => {
    const centerX = range ? (range.minX + range.maxX) / 2 : 0;
    const spanX = range ? range.maxX - range.minX : KEYBOARD_EXTENT.width;
    const view = viewFor(preset, centerX, spanX);
    // 待機中だけ、ゆっくり揺らぐ
    const sway = running ? 0 : Math.sin(clock.elapsedTime * 0.3) * 0.01;
    goal.current.copy(view.position).add(new Vector3(sway, sway * 0.4, 0));
    const ease = 1 - Math.exp(-delta * 4.5); // 約 0.8 秒で追いつく
    camera.position.lerp(goal.current, ease);
    look.current.lerp(view.target, ease);
    camera.lookAt(look.current);
  });
  return null;
}
