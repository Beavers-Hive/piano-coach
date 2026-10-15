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

/** 1 拍ごとのクリック。小節の頭（accent）は、少し高く強い音にする。 */
export function metronome(time?: number, accent = false): void {
  click ??= new Tone.MembraneSynth({
    pitchDecay: 0.01,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
  }).toDestination();
  click.volume.value = accent ? -6 : -11;
  click.triggerAttackRelease(accent ? "G6" : "C6", "32n", time);
}

/**
 * 演奏モードの「合わせる目安」のお手本の音。自分の演奏の邪魔にならないよう、少し控えめに鳴らす。
 * time は Tone の時刻（Transport のコールバックで渡される値）。
 */
export function playGuideNote(
  pitch: number,
  durationSeconds: number,
  time: number,
): void {
  piano().triggerAttackRelease(
    Tone.Frequency(pitch, "midi").toNote(),
    Math.max(0.08, durationSeconds),
    time,
    0.55,
  );
}

/** 音が実際に出るまでの遅れ（ミリ秒）。画面の拍と、聞こえる拍を揃えるために使う。 */
export function outputLatencyMs(): number {
  const context = Tone.getContext().rawContext as AudioContext;
  const seconds = context.outputLatency ?? context.baseLatency ?? 0;
  return Math.min(150, Math.max(0, seconds * 1000));
}
