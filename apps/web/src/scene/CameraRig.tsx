import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3 } from "three";
import { useAppStore } from "../state/store";

const VIEWS: Record<
  string,
  { position: [number, number, number]; target: [number, number, number] }
> = {
  overview: { position: [0, 0.72, 1.18], target: [0, 0.02, -0.2] },
  play: { position: [0.08, 0.46, 0.72], target: [0.04, 0.02, 0] },
  closeup: { position: [0.18, 0.27, 0.43], target: [0.14, 0.015, 0.01] },
  score: { position: [0, 0.86, 1.35], target: [0, 0.2, -0.25] },
};

export function CameraRig() {
  const camera = useThree((state) => state.camera);
  const preset = useAppStore((state) => state.camera);
  const running = useAppStore((state) => state.running);
  const target = useRef(new Vector3());
  const position = useRef(new Vector3());

  useFrame(({ clock }, delta) => {
    const view = VIEWS[preset];
    const idle = running ? 0 : Math.sin(clock.elapsedTime * 0.33) * 0.012;
    position.current.set(
      view.position[0] + idle,
      view.position[1] + idle * 0.4,
      view.position[2],
    );
    target.current.set(...view.target);
    camera.position.lerp(position.current, 1 - Math.exp((-delta / 0.8) * 5));
    const look = new Vector3().lerpVectors(
      camera.getWorldDirection(new Vector3()).add(camera.position),
      target.current,
      1 - Math.exp((-delta / 0.8) * 5),
    );
    camera.lookAt(look);
  });
  return null;
}
