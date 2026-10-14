import { describe, expect, it } from "vitest";
import { getPlayheadMs, setTimeScale, startClock, stopClock } from "./clock";

describe("practice clock", () => {
  it("keeps playhead continuous when timeScale changes", () => {
    startClock(0, 100);
    expect(getPlayheadMs(200)).toBe(100);
    setTimeScale(0.5, 200);
    expect(getPlayheadMs(200)).toBe(100);
    expect(getPlayheadMs(400)).toBe(200);
    stopClock();
  });
});
