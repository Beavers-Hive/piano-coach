import { useAppStore } from "../state/store";

export type NoteHandler = (
  pitch: number,
  velocity: number,
  on: boolean,
  timestamp: number,
) => void;

let access: MIDIAccess | undefined;
let input: MIDIInput | undefined;
let handler: NoteHandler | undefined;
let disconnectHandler: () => void = () => undefined;
const preferredPortKey = "piano-coach-midi-port";
let preferredPortName: string | undefined;

export async function initialiseMidi(next: NoteHandler): Promise<void> {
  handler = next;
  preferredPortName ??= readPreferredPort();
  if (!navigator.requestMIDIAccess) {
    unavailable(
      "このブラウザでは MIDI を使えません。PC キーボードで演奏できます。",
    );
    return;
  }
  try {
    access = await navigator.requestMIDIAccess();
    access.onstatechange = refresh;
    refresh();
  } catch {
    unavailable("MIDI の権限が拒否されました。PC キーボードで演奏できます。");
  }
}

export function setMidiDisconnectHandler(next: () => void): void {
  disconnectHandler = next;
}

export function selectMidi(name: string): void {
  if (!access) return;
  preferredPortName = name;
  writePreferredPort(name);
  attachInput(
    [...access.inputs.values()].find((port) => (port.name ?? port.id) === name),
  );
}

function refresh(): void {
  const ports = access ? [...access.inputs.values()] : [];
  useAppStore
    .getState()
    .set({ midiPorts: ports.map((port) => port.name ?? port.id) });
  if (input && input.state !== "connected") {
    input.removeEventListener("midimessage", onMessage);
    input = undefined;
    useAppStore.getState().set({
      selectedPort: preferredPortName,
      error:
        "MIDI 接続が切れました。PC キーボードで続けるか、再接続してください。",
      pressed: new Set(),
    });
    disconnectHandler();
  }
  if (!input && preferredPortName) {
    attachInput(
      ports.find(
        (port) =>
          port.state === "connected" &&
          (port.name ?? port.id) === preferredPortName,
      ),
    );
  }
}

function attachInput(next: MIDIInput | undefined): void {
  if (!next) return;
  input?.removeEventListener("midimessage", onMessage);
  input = next;
  input.addEventListener("midimessage", onMessage);
  const name = input.name ?? input.id;
  useAppStore.getState().set({
    selectedPort: name,
    midiUnavailable: false,
    error: undefined,
  });
}

function readPreferredPort(): string | undefined {
  try {
    return localStorage.getItem(preferredPortKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePreferredPort(name: string): void {
  try {
    localStorage.setItem(preferredPortKey, name);
  } catch {
    // 非永続コンテキストではこのセッション中だけ覚える。
  }
}

function unavailable(message: string): void {
  useAppStore.getState().set({ midiUnavailable: true, error: message });
}

function onMessage(event: MIDIMessageEvent): void {
  if (!event.data) return;
  const [status, pitch, velocity = 0] = event.data;
  const type = status & 0xf0;
  if (type !== 0x90 && type !== 0x80) return;
  const on = type === 0x90 && velocity > 0;
  useAppStore.getState().set({ midiTest: midiName(pitch) });
  handler?.(pitch, velocity, on, event.timeStamp);
}

function midiName(pitch: number): string {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function resetMidiInputForTest(): void {
  input?.removeEventListener("midimessage", onMessage);
  access = undefined;
  input = undefined;
  handler = undefined;
  disconnectHandler = () => undefined;
  preferredPortName = undefined;
}
