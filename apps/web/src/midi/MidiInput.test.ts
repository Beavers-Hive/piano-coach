import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../state/store";
import {
  initialiseMidi,
  resetMidiInputForTest,
  selectMidi,
  setMidiDisconnectHandler,
} from "./MidiInput";

function makeInput(name: string, state: MIDIPortDeviceState): MIDIInput {
  return {
    id: name,
    name,
    state,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MIDIInput;
}

describe("MIDI input reconnection", () => {
  beforeEach(() => {
    resetMidiInputForTest();
    useAppStore.getState().set({ error: undefined, selectedPort: undefined });
  });

  afterEach(() => resetMidiInputForTest());

  it("reselects the preferred port when the same name reconnects", async () => {
    const disconnected = vi.fn();
    const first = makeInput("JUNO-DS88", "connected");
    const inputs = new Map<string, MIDIInput>([[first.id, first]]);
    const access = {
      inputs,
      onstatechange: null,
    } as unknown as MIDIAccess;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { requestMIDIAccess: vi.fn().mockResolvedValue(access) },
    });

    await initialiseMidi(vi.fn());
    setMidiDisconnectHandler(disconnected);
    selectMidi("JUNO-DS88");

    (first as unknown as { state: MIDIPortDeviceState }).state = "disconnected";
    access.onstatechange?.({} as MIDIConnectionEvent);
    expect(first.removeEventListener).toHaveBeenCalledWith(
      "midimessage",
      expect.any(Function),
    );
    expect(disconnected).toHaveBeenCalledOnce();

    const reconnected = makeInput("JUNO-DS88", "connected");
    inputs.set(reconnected.id, reconnected);
    access.onstatechange?.({} as MIDIConnectionEvent);

    expect(reconnected.addEventListener).toHaveBeenCalledWith(
      "midimessage",
      expect.any(Function),
    );
    expect(useAppStore.getState().selectedPort).toBe("JUNO-DS88");
  });
});
