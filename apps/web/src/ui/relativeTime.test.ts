import { describe, expect, it } from "vitest";
import { relativeTimeJa } from "./relativeTime";

const now = new Date(2026, 9, 15, 12, 0, 0);
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("relativeTimeJa", () => {
  it("shows minutes, hours, yesterday, days and weeks", () => {
    expect(relativeTimeJa(ago(20_000), now)).toBe("たった今");
    expect(relativeTimeJa(ago(5 * 60_000), now)).toBe("5 分前");
    expect(relativeTimeJa(ago(2 * 3_600_000 + 60_000), now)).toBe("2 時間前");
    expect(relativeTimeJa(new Date(2026, 9, 14, 8, 0).toISOString(), now)).toBe(
      "昨日",
    );
    expect(relativeTimeJa(new Date(2026, 9, 12, 8, 0).toISOString(), now)).toBe(
      "3 日前",
    );
    expect(relativeTimeJa(new Date(2026, 9, 7, 8, 0).toISOString(), now)).toBe(
      "1 週間前",
    );
  });
  it("falls back to a date for old entries and empty for invalid input", () => {
    expect(relativeTimeJa(new Date(2026, 7, 3, 8, 0).toISOString(), now)).toBe(
      "8 月 3 日",
    );
    expect(relativeTimeJa("not a date", now)).toBe("");
  });
});
