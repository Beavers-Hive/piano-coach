import { expect, test } from "@playwright/test";
import { dismissEntryResume, startFromBeginning } from "./helpers";

// 本物の Gemini と Cloud TTS を使った通しテスト。サブスクの利用枠を使うので、普段は実行しない。
//   PIANO_COACH_REAL=1 npx playwright test -c playwright.real.config.ts
// 起動済みのサーバー（8787、本物の Gemini）、TTS（8790）、vite（5173）を使う。
// Gemini の返答の文面は毎回変わるので、文言ではなく流れ（状態の遷移）と、声が Cloud TTS で鳴ったことを検証する。

const SHOTS = "test-results-real/shots";

test.skip(
  !process.env.PIANO_COACH_REAL,
  "PIANO_COACH_REAL=1 のときだけ実行する",
);

test("real Gemini + Cloud TTS: hearing → plan → demo → practice → feedback", async ({
  page,
}) => {
  test.setTimeout(6 * 60_000);
  const ttsClips: string[] = [];
  const log: string[] = [];
  const started = Date.now();
  const mark = (label: string) =>
    log.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`);
  page.on("request", (request) => {
    if (request.url().includes("/api/tts/")) ttsClips.push(request.url());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "音声を有効にして準備する" }).click();
  await page.getByRole("button", { name: "レッスンへ進む" }).click();
  const songSelect = page.locator('select[aria-label="曲を選択"]');
  await dismissEntryResume(page);
  await songSelect.selectOption({ index: 1 });
  await startFromBeginning(page, 60_000);
  mark("曲を選択");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/0-import.png` });

  // ヒアリング: 質問が出るたびに最初の選択肢を選ぶ（Gemini が聞くのは最大 2 問）
  for (let round = 0; round < 3; round++) {
    const question = page.locator(".question");
    const plan = page.locator(".plan");
    await expect(question.or(plan).first()).toBeVisible({ timeout: 60_000 });
    if (await plan.isVisible()) break;
    mark(`質問: ${(await question.innerText()).split("\n")[0]}`);
    await page.screenshot({ path: `${SHOTS}/1-hearing-${round}.png` });
    await question.locator("button").first().click();
    await page.waitForTimeout(500);
  }
  await expect(page.locator(".plan")).toBeVisible({ timeout: 90_000 });
  mark("計画が表示された");
  await page.screenshot({ path: `${SHOTS}/2-plan.png` });

  // お手本（初心者なら demo になるはず）。来た場合は早送りする
  const startButton = page.getByRole("button", {
    name: "鍵盤を押してスタート",
  });
  if (
    await page
      .locator(".state")
      .innerText()
      .then((text) => /demo/i.test(text))
  ) {
    mark("お手本の再生");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/3-demo.png` });
    await page.evaluate(() => window.__pianoCoach?.setTimeScale(4));
  }
  await expect(startButton).toBeVisible({ timeout: 120_000 });
  mark("課題の準備完了");
  await page.screenshot({ path: `${SHOTS}/4-briefing.png` });

  // 完璧に弾く。wait モードは次の音（和音）が揃うまで止まるので、順番に押す。play モードは予定時刻どおりに押す
  await page.evaluate(() => window.__pianoCoach?.pressKey(60));
  await page.evaluate(async () => {
    const api = window.__pianoCoach!;
    const timeline = api.getState().timeline!;
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(timeline.countInMs + 50);
    if (timeline.spec.mode === "wait") {
      const chords = new Map<number, number[]>();
      for (const note of timeline.notes)
        chords.set(note.startMs, [
          ...(chords.get(note.startMs) ?? []),
          note.pitch,
        ]);
      for (const pitches of chords.values()) {
        for (const pitch of pitches) api.pressKey(pitch, 90);
        await sleep(120);
        for (const pitch of pitches) api.releaseKey(pitch);
        await sleep(80);
      }
      return;
    }
    const startedAt = performance.now();
    for (const note of timeline.notes) {
      const wait = note.startMs - (performance.now() - startedAt);
      if (wait > 0) await sleep(wait);
      api.pressKey(note.pitch, 90);
      setTimeout(
        () => api.releaseKey(note.pitch),
        Math.max(60, note.durationMs * 0.7),
      );
    }
  });
  mark("演奏を送信");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/5-practice-end.png` });

  // 講評が出て、次の課題（briefing）に進む
  await expect(page.locator(".state")).toContainText(/briefing|demo|finished/, {
    timeout: 90_000,
  });
  mark(`講評: ${await page.locator(".subtitle").innerText()}`);
  await page.screenshot({ path: `${SHOTS}/6-feedback.png` });

  const fallbackUsed = await page.evaluate(() =>
    Boolean(window.__pianoCoach?.getState().fallbackVoiceAt),
  );
  mark(
    `Cloud TTS のクリップ数: ${ttsClips.length}、代替音声: ${fallbackUsed ? "あり" : "なし"}`,
  );
  console.log(log.join("\n"));
  expect(ttsClips.length).toBeGreaterThan(0);
  expect(fallbackUsed).toBe(false);
});
