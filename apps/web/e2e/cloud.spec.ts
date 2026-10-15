import { expect, test } from "@playwright/test";
import type { ExerciseTimeline, WireMessage } from "../src/types";

test.skip(
  !process.env.PIANO_COACH_REAL || !process.env.PIANO_COACH_BASE_URL,
  "Explicitly enable paid Gemini / Cloud TTS tests against a deployed service",
);

test("deployed Gemini lesson: hearing, demo, MIDI attempt, feedback and next task", async ({
  page,
}) => {
  test.setTimeout(6 * 60_000);
  // Only the physical MIDI device is simulated. The production bundle, all APIs,
  // Gemini decisions, audio generation and WebSocket messages are real.
  await page.addInitScript(() => {
    let listener:
      ((event: { data: Uint8Array; timeStamp: number }) => void) | undefined;
    const port = {
      id: "e2e-midi",
      name: "E2E MIDI",
      state: "connected",
      addEventListener: (_: string, callback: typeof listener) => {
        listener = callback;
      },
      removeEventListener: () => {
        listener = undefined;
      },
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => ({
        inputs: new Map([[port.id, port]]),
        onstatechange: null,
      }),
    });
    (
      window as unknown as { __testMidi: (pitch: number, on: boolean) => void }
    ).__testMidi = (pitch, on) =>
      listener?.({
        data: new Uint8Array([on ? 0x90 : 0x80, pitch, on ? 90 : 0]),
        timeStamp: performance.now(),
      });
  });
  const messages: WireMessage[] = [];
  const voiceRequests: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framereceived", (event) => {
      try {
        messages.push(JSON.parse(event.payload.toString()) as WireMessage);
      } catch {
        /* not JSON */
      }
    }),
  );
  page.on("request", (r) => {
    if (r.url().includes("/api/tts/")) voiceRequests.push(r.url());
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "先生（Gemini）" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "音声を有効にして準備する" }).click();
  await page.locator("select").selectOption({ label: "E2E MIDI" });
  const voiceResponse = page.waitForResponse((r) =>
    r.url().endsWith("/api/voice/test"),
  );
  await page.getByRole("button", { name: "先生の声をテスト" }).click();
  expect((await (await voiceResponse).json()).engine).toBe("google");
  await page.screenshot({ path: "test-results-real/shots/cloud-setup.png" });
  await page.getByRole("button", { name: "レッスンへ進む" }).click();
  const songs = page.getByRole("combobox", { name: "曲を選択" });
  await expect(songs.locator("option")).toHaveCount(3);
  await songs.selectOption({
    label: "メヌエット ト長調 — ペツォールト（伝 J.S.バッハ）",
  });
  for (let round = 0; round < 3; round++) {
    await expect(
      page.locator(".question").or(page.locator(".plan")).first(),
    ).toBeVisible({ timeout: 90_000 });
    if (await page.locator(".plan").isVisible()) break;
    const question = page.locator(".question");
    const free = question.getByPlaceholder("自由に入力");
    if (await free.isVisible()) {
      await free.fill(
        "はじめてです。右手で最初の1小節だけ、正しい鍵盤まで待つ練習をしたいです。",
      );
      await question.getByRole("button", { name: "送信", exact: true }).click();
    } else {
      const beginner = question
        .getByRole("button", { name: /はじめて|初心者|右手|最初/ })
        .first();
      if (await beginner.count()) await beginner.click();
      else await question.locator("button").first().click();
    }
  }
  await expect(page.locator(".plan")).toBeVisible({ timeout: 90_000 });
  expect(messages.find(m => m.type === "song.analysis")?.payload.summary).not.toBe("楽譜を読み込みました。");
  await expect.poll(() => messages.filter(m => m.type === "fingering.updated").length,
    { timeout: 90_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results-real/shots/cloud-plan.png" });
  await expect
    .poll(
      () =>
        (
          messages.filter((m) => m.type === "exercise.ready").at(-1)?.payload
            .timeline as ExerciseTimeline | undefined
        )?.spec.mode,
      { timeout: 180_000 },
    )
    .toMatch(/^(wait|play)$/);
  await expect(
    page.getByRole("button", { name: "鍵盤を押してスタート" }),
  ).toBeVisible({ timeout: 180_000 });
  const ready = messages.filter((m) => m.type === "exercise.ready").at(-1)!;
  const timeline = ready.payload.timeline as ExerciseTimeline;
  expect(timeline.spec.mode).not.toBe("watch");
  await page.getByRole("button", { name: "鍵盤を押してスタート" }).click();
  await expect(page.locator(".state")).toHaveAttribute(
    "data-state",
    "practicing",
    { timeout: 15_000 },
  );
  await page.screenshot({ path: "test-results-real/shots/cloud-practice.png" });
  await page.evaluate(async (current) => {
    const midi = (
      window as unknown as { __testMidi: (pitch: number, on: boolean) => void }
    ).__testMidi;
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const groups = new Map<number, number[]>();
    for (const note of current.notes)
      groups.set(note.startMs, [
        ...(groups.get(note.startMs) || []),
        note.pitch,
      ]);
    const started = performance.now();
    for (const [at, pitches] of groups) {
      if (current.spec.mode === "play")
        await sleep(Math.max(0, at - (performance.now() - started)));
      for (const pitch of pitches) midi(pitch, true);
      await sleep(80);
      for (const pitch of pitches) midi(pitch, false);
      if (current.spec.mode === "wait") await sleep(60);
    }
  }, timeline);
  const before = messages.length;
  await expect
    .poll(
      () =>
        messages
          .slice(before)
          .some(
            (m) =>
              m.type === "exercise.ready" ||
              (m.type === "lesson.state" && m.payload.state === "finished"),
          ),
      { timeout: 90_000 },
    )
    .toBe(true);
  expect(messages.slice(before).some((m) => m.type === "agent.say")).toBe(true);
  expect(voiceRequests.length).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results-real/shots/cloud-feedback.png" });
  console.log(
    JSON.stringify({
      model: "gemini-3.5-flash",
      voiceClips: voiceRequests.length,
      plan: messages.find((m) => m.type === "plan.updated")?.payload,
      attempted: timeline.spec,
      next: messages.filter((m) => m.type === "exercise.ready").at(-1)?.payload,
      fingeringUpdates: messages.filter((m) => m.type === "fingering.updated")
        .length,
    }),
  );
});
