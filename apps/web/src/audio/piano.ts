import * as Tone from "tone";

const sampleMap: Record<string, string> = {};
for (let octave = 1; octave <= 7; octave += 1) {
  sampleMap[`C${octave}`] = `C${octave}.mp3`;
  sampleMap[`D#${octave}`] = `Ds${octave}.mp3`;
  sampleMap[`F#${octave}`] = `Fs${octave}.mp3`;
  sampleMap[`A${octave}`] = `A${octave}.mp3`;
}
sampleMap.A0 = "A0.mp3";
sampleMap.C8 = "C8.mp3";

let sampler: Tone.Sampler | undefined;
let initialized = false;
let click: Tone.MembraneSynth | undefined;

export function piano(): Tone.Sampler {
  if (!sampler) {
    sampler = new Tone.Sampler({
      urls: sampleMap,
      baseUrl: "/samples/",
      release: 1.4,
      volume: -5,
    }).toDestination();
  }
  return sampler;
}

export async function unlockPiano(): Promise<void> {
  await Tone.start();
  piano();
  if (!initialized) {
    await Tone.loaded();
    initialized = true;
  }
}

export function playPiano(pitch: number, duration = 0.3, time?: number): void {
  piano().triggerAttackRelease(
    Tone.Frequency(pitch, "midi").toNote(),
    duration,
    time,
  );
}

export function setPianoDuck(ducked: boolean): void {
  piano().volume.rampTo(ducked ? -17 : -5, 0.12);
}

export function metronome(time?: number): void {
  click ??= new Tone.MembraneSynth({
    pitchDecay: 0.01,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
  }).toDestination();
  click.volume.value = -10;
  click.triggerAttackRelease("C6", "32n", time);
}
