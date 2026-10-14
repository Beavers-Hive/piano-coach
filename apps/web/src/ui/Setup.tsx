import { useState } from "react";
import { unlockPiano } from "../audio/piano";
import { selectMidi } from "../midi/MidiInput";
import { useAppStore } from "../state/store";
export function Setup({ onBegin }: { onBegin: () => void }) {
  const [busy, setBusy] = useState(false);
  const state = useAppStore();
  const begin = async () => {
    setBusy(true);
    try {
      await unlockPiano();
      state.set({ ready: true, samplerReady: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="setup">
      <div className="setup-card">
        <p className="eyebrow">PIANO COACH / DEMO CHECK</p>
        <h1>準備はできましたか？</h1>
        <p>音源、MIDI、先生の声を一度ここで確かめます。</p>
        <button
          className="primary"
          onClick={() => void begin()}
          disabled={busy}
        >
          {busy ? "音源を読み込み中…" : "音声を有効にして準備する"}
        </button>
        <section className="checks">
          <Check
            ok={state.samplerReady}
            label="Salamander Grand Piano"
            value={state.samplerReady ? "準備完了" : "クリックして読み込み"}
          />
          <Check
            ok={Boolean(state.health)}
            label="Claude / Irodori"
            value={
              state.health
                ? `Claude ${state.health.claude ? "OK" : "—"} · TTS ${state.health.tts ? "OK" : "—"}`
                : "確認中"
            }
          />
          <label className="midi-select">
            <span> MIDI 入力（JUNO-DS88）</span>
            <select
              value={state.selectedPort ?? ""}
              onChange={(e) => selectMidi(e.target.value)}
            >
              <option value="">ポートを選択</option>
              {state.midiPorts.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <small>
              打鍵テスト: {state.midiTest ?? "鍵盤を押してください"}
            </small>
          </label>
          {state.midiUnavailable && (
            <p role="status">
              MIDI は使えません。PC
              キーボード（A〜K、W/E/T/Y/U）で入力できます。
            </p>
          )}
        </section>
        <div className="setup-actions">
          <button
            onClick={() => {
              const u = new SpeechSynthesisUtterance(
                "先生の声のテストです。準備できました！",
              );
              u.lang = "ja-JP";
              speechSynthesis.speak(u);
            }}
          >
            先生の声をテスト
          </button>
          <button className="primary" disabled={!state.ready} onClick={onBegin}>
            レッスンへ進む →
          </button>
        </div>
      </div>
    </main>
  );
}
function Check({
  ok,
  label,
  value,
}: {
  ok: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="check">
      <i className={ok ? "ok" : ""} /> <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
