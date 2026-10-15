import { useState } from "react";
import { unlockPiano } from "../audio/piano";
import { selectMidi } from "../midi/MidiInput";
import { useAppStore } from "../state/store";
import { LogoMark } from "./icons";
type VoiceTestResult = { engine: "irodori" | "webspeech" };

/** 準備画面の声のテスト。必ずサーバー経由で Irodori を通し、どちらの声で鳴ったかを返す。 */
async function testVoice(report: (result: VoiceTestResult) => void) {
  const speakWithBrowser = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    speechSynthesis.speak(utterance);
  };
  try {
    const response = await fetch("/api/voice/test", { method: "POST" });
    const data = (await response.json()) as {
      engine: "irodori" | "webspeech";
      urls: string[];
      text: string;
    };
    if (data.engine === "irodori") {
      for (const url of data.urls) {
        const audio = new Audio(url);
        await audio.play();
        await new Promise((resolve) => (audio.onended = resolve));
      }
    } else {
      speakWithBrowser(data.text);
    }
    report({ engine: data.engine });
  } catch {
    speakWithBrowser("先生の声のテストです。");
    report({ engine: "webspeech" });
  }
}

export function Setup({ onBegin }: { onBegin: () => void }) {
  const [busy, setBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceTestResult | null>(null);
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
      <div className="setup-stage" aria-hidden="true">
        <div className="setup-glow" />
        {[8, 19, 27, 41, 58, 69, 83].map((left, index) => (
          <i
            key={left}
            className="setup-note"
            style={{
              left: `${left}%`,
              animationDelay: `${(index * 1.7) % 6}s`,
              animationDuration: `${7 + (index % 3) * 1.6}s`,
              height: `${60 + ((index * 37) % 90)}px`,
            }}
          />
        ))}
        <div className="setup-keys" />
      </div>
      <div className="setup-card">
        <section className="setup-hero">
          <div className="setup-logo">
            <LogoMark size={34} />
            <span>
              PIANO <em>COACH</em>
            </span>
          </div>
          <h1>
            楽譜を渡すだけ。
            <span>AI の先生が、あなた専属で教えてくれる</span>
          </h1>
          <p className="lead">
            3D
            の鍵盤とホログラムの手でお手本を見せ、あなたの演奏をその場で聴いて、声で講評します。
          </p>
          <ul className="setup-features">
            <li>運指を設計</li>
            <li>リアルタイム判定</li>
            <li>声で講評</li>
          </ul>
        </section>
        <section className="setup-panel">
          <p className="eyebrow">出発前のチェック</p>
          <button
            className={`primary wide${state.samplerReady ? " done" : ""}`}
            onClick={() => void begin()}
            disabled={busy || state.samplerReady}
          >
            {busy ? "音源を読み込み中…" : "音声を有効にして準備する"}
          </button>
          <div className="checks">
            <Check
              ok={state.samplerReady}
              label="Salamander Grand Piano"
              value={state.samplerReady ? "準備完了" : "クリックして読み込み"}
            />
            <Check
              ok={Boolean(state.health?.claude)}
              label="Claude（先生の頭脳）"
              value={
                state.health
                  ? state.health.claude
                    ? "接続中"
                    : "未接続"
                  : "確認中"
              }
            />
            <Check
              ok={Boolean(state.health?.tts)}
              label="Irodori（先生の声）"
              value={
                state.health
                  ? state.health.tts
                    ? "接続中"
                    : "未接続"
                  : "確認中"
              }
            />
            <Check
              ok={Boolean(state.selectedPort)}
              label="MIDI キーボード"
              value={
                state.selectedPort
                  ? "接続中"
                  : state.midiUnavailable
                    ? "PC キーボードで代用"
                    : "ポートを選択"
              }
            />
          </div>
          {voiceResult && (
            <p
              role="status"
              className={
                voiceResult.engine === "irodori" ? "voice-ok" : "voice-warning"
              }
            >
              {voiceResult.engine === "irodori"
                ? "Irodori の声で再生しました"
                : "Irodori に接続できていません（ブラウザの音声で代替中）"}
            </p>
          )}
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
            <p role="status" className="note">
              MIDI は使えません。PC
              キーボード（A〜K、W/E/T/Y/U）で入力できます。
            </p>
          )}
          <div className="setup-actions">
            <button
              className="ghost"
              onClick={() => void testVoice(setVoiceResult)}
            >
              先生の声をテスト
            </button>
            <button
              className="primary"
              disabled={!state.ready}
              onClick={onBegin}
            >
              レッスンへ進む →
            </button>
          </div>
        </section>
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
    <div className={`check${ok ? " ok" : ""}`}>
      <i className={ok ? "ok" : ""} /> <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
