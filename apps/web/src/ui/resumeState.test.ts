import { describe, expect, it } from "vitest";
import type { SavedProgress, SongEntry } from "../types";
import { newestResumable, resumeTargetOf } from "./resumeState";

const progress = (updatedAt: string, finished = false): SavedProgress => ({
  stepIndex: 1,
  stepCount: 4,
  stepTitle: "右手",
  goal: "目標",
  updatedAt,
  finished,
});
const song = (songId: string, p: SavedProgress | null): SongEntry => ({
  songId,
  title: songId,
  composer: "",
  progress: p,
});

describe("resume targets", () => {
  it("picks the song with the newest updatedAt", () => {
    const found = newestResumable([
      song("a", progress("2026-10-14T10:00:00Z")),
      song("b", null),
      song("c", progress("2026-10-15T01:00:00Z")),
    ]);
    expect(found?.songId).toBe("c");
  });
  it("ignores songs without progress or finished ones", () => {
    expect(newestResumable([song("a", null)])).toBeNull();
    expect(
      resumeTargetOf(song("a", progress("2026-10-14T10:00:00Z", true))),
    ).toBeNull();
    expect(resumeTargetOf(undefined)).toBeNull();
  });
});
