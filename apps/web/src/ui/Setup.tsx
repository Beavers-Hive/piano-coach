import { useState } from "react";
import type React from "react";
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

type ChipTone = "ok" | "warn" | "idle" | "busy";

/** 状態のチップ（色付きの点と短い文）。 */
function Chip({ tone, children }: { tone: ChipTone; children: string }) {
  return (
    <span className={`chip chip-${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** 準備のチェックリストの 1 行。 */
function Step({
  index,
  title,
  detail,
  status,
  children,
}: {
  index: number;
  title: string;
  detail: string;
  status: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="step">
      <span className="step-index">{index}</span>
      <div className="step-body">
        <div className="step-head">
          <h2>{title}</h2>
          {status}
        </div>
        <p>{detail}</p>
        {children && <div className="step-action">{children}</div>}
      </div>
    </li>
  );
}

export function Setup({ onBegin }: { onBegin: () => void }) {
  const [busy, setBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
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
  const runVoiceTest = async () => {
    setVoiceBusy(true);
    try {
      await testVoice(setVoiceResult);
    } finally {
      setVoiceBusy(false);
    }
  };
  const health = state.health;
  const ttsTone: ChipTone = !health ? "busy" : health.tts ? "ok" : "warn";
  const claudeTone: ChipTone = !health ? "busy" : health.claude ? "ok" : "warn";
  const midiTone: ChipTone = state.selectedPort
    ? "ok"
    : state.midiUnavailable
      ? "warn"
      : "idle";

  return (
    <main className="setup">
      <div className="setup-sheet">
        <div className="setup-header">
          <div className="setup-brand">
            <LogoMark size={28} />
            <span>Piano Coach</span>
          </div>
          <h1>レッスンの準備</h1>
          <p>音と機材を確認してから、レッスンを始めます。</p>
        </div>

        <ol className="steps">
          <Step
            index={1}
            title="音を鳴らす"
            detail="ピアノ音源（Salamander Grand Piano）を読み込みます。ブラウザの制約で、最初に一度だけ操作が必要です。"
            status={
              <Chip tone={state.samplerReady ? "ok" : busy ? "busy" : "idle"}>
                {state.samplerReady
                  ? "準備完了"
                  : busy
                    ? "読み込み中"
                    : "未準備"}
              </Chip>
            }
          >
            <button
              className="btn"
              onClick={() => void begin()}
              disabled={busy || state.samplerReady}
            >
              {busy ? "読み込み中…" : "音声を有効にして準備する"}
            </button>
          </Step>

          <Step
            index={2}
            title="MIDI キーボード"
            detail="演奏に使う鍵盤を選びます。つながっていなくても、PC のキーボード（A〜K、W/E/T/Y/U）で弾けます。"
            status={
              <Chip tone={midiTone}>
                {state.selectedPort
                  ? "接続中"
                  : state.midiUnavailable
                    ? "PC キーボードで代用"
                    : "未選択"}
              </Chip>
            }
          >
            <label className="midi-select">
              <span className="visually-hidden">MIDI 入力（JUNO-DS88）</span>
              <select
                value={state.selectedPort ?? ""}
                onChange={(e) => selectMidi(e.target.value)}
                disabled={state.midiUnavailable && !state.midiPorts.length}
              >
                <option value="">
                  {state.midiPorts.length
                    ? "ポートを選択"
                    : "MIDI 機器が見つかりません"}
                </option>
                {state.midiPorts.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <span className="key-probe" aria-live="polite">
              {state.midiTest
                ? `押した鍵: ${state.midiTest}`
                : "鍵盤を押すと、ここに表示されます"}
            </span>
          </Step>

          <Step
            index={3}
            title="先生の声"
            detail="Irodori（先生の声）で短い文を読み上げます。代わりのブラウザの声になった場合は、声のサーバーを確認してください。"
            status={
              <Chip
                tone={
                  voiceBusy
                    ? "busy"
                    : voiceResult
                      ? voiceResult.engine === "irodori"
                        ? "ok"
                        : "warn"
                      : ttsTone
                }
              >
                {voiceBusy
                  ? "再生中"
                  : voiceResult
                    ? voiceResult.engine === "irodori"
                      ? "Irodori で再生"
                      : "代替の声"
                    : !health
                      ? "確認中"
                      : health.tts
                        ? "接続中"
                        : "未接続"}
              </Chip>
            }
          >
            <button
              className="btn"
              onClick={() => void runVoiceTest()}
              disabled={voiceBusy}
            >
              先生の声をテスト
            </button>
            {voiceResult && voiceResult.engine !== "irodori" && (
              <p role="status" className="voice-warning">
                Irodori に接続できていません（ブラウザの音声で代替中）
              </p>
            )}
          </Step>

          <Step
            index={4}
            title="先生（Claude）"
            detail="ヒアリング、指導計画、講評を担当します。サブスクでログインした Claude Code を使います。"
            status={
              <Chip tone={claudeTone}>
                {!health ? "確認中" : health.claude ? "接続中" : "未接続"}
              </Chip>
            }
          />
        </ol>

        <div className="setup-footer">
          <p className="setup-hint">
            {state.ready
              ? "準備ができました。"
              : "「音を鳴らす」を済ませると、レッスンを始められます。"}
          </p>
          <button
            className="btn btn-primary"
            disabled={!state.ready}
            onClick={onBegin}
          >
            レッスンへ進む
          </button>
        </div>
      </div>
    </main>
  );
}
