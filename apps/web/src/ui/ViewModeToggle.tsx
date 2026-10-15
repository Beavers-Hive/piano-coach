import type { ViewMode } from "../state/store";
import { useAppStore } from "../state/store";

const MODES: { id: ViewMode; label: string }[] = [
  { id: "notes", label: "ノーツ" },
  { id: "score", label: "楽譜" },
  { id: "both", label: "両方" },
];

export function ViewModeToggle() {
  const viewMode = useAppStore((state) => state.viewMode);
  const set = useAppStore((state) => state.set);
  return (
    <div className="view-mode-toggle" role="group" aria-label="表示モード">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          aria-pressed={viewMode === mode.id}
          className={viewMode === mode.id ? "active" : ""}
          onClick={() => set({ viewMode: mode.id })}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
