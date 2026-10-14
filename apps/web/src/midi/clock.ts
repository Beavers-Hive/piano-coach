// 課題の再生に使う唯一の時計（統合担当が管理。公開している関数のシグネチャは変更しないこと）。
// ノーツの落下、判定、お手本の音、3D の手は、すべてこの時計の playhead を読む。
// React の state には入れない（毎フレームの再レンダーを避けるため）。useFrame の中で getPlayheadMs() を読むこと。

type ClockState = {
  running: boolean;
  startedAt: number; // performance.now() 基準。playhead = 0 になる実時刻
  pausedAt: number | null; // 一時停止中の playhead
  timeScale: number; // 1 = 等速。お手本のスロー再生や E2E の早送りに使う
  offsetMs: number; // timeScale を変えたときに playhead を連続させるための補正
};

const state: ClockState = {
  running: false,
  startedAt: 0,
  pausedAt: 0,
  timeScale: 1,
  offsetMs: 0,
};

/** 課題の先頭からの経過ミリ秒。カウントイン中は負の値になる。 */
export function getPlayheadMs(now: number = performance.now()): number {
  if (!state.running) return state.pausedAt ?? 0;
  return state.offsetMs + (now - state.startedAt) * state.timeScale;
}

/** playhead = startPlayheadMs から再生を始める（カウントインは負の値から始める）。 */
export function startClock(
  startPlayheadMs = 0,
  now: number = performance.now(),
): void {
  state.running = true;
  state.startedAt = now;
  state.offsetMs = startPlayheadMs;
  state.pausedAt = null;
}

export function pauseClock(now: number = performance.now()): void {
  if (!state.running) return;
  state.pausedAt = getPlayheadMs(now);
  state.running = false;
}

export function resumeClock(now: number = performance.now()): void {
  if (state.running) return;
  startClock(state.pausedAt ?? 0, now);
}

export function stopClock(): void {
  state.running = false;
  state.pausedAt = 0;
}

/** 再生速度を変える。playhead は連続したまま、以降の進み方だけが変わる。 */
export function setTimeScale(
  scale: number,
  now: number = performance.now(),
): void {
  const current = getPlayheadMs(now);
  state.timeScale = scale;
  if (state.running) {
    state.startedAt = now;
    state.offsetMs = current;
  }
}

export function getTimeScale(): number {
  return state.timeScale;
}

export function isClockRunning(): boolean {
  return state.running;
}

/** playhead（ミリ秒）を実時刻（performance.now() 基準）に変換する。MIDI の timeStamp との照合に使う。 */
export function playheadToNow(playheadMs: number): number {
  return state.startedAt + (playheadMs - state.offsetMs) / state.timeScale;
}
