import { expect, test } from "@playwright/test";

test("fake-brain lesson completes a guided wait-mode attempt", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "音声を有効にして準備する" }).click();
  await page.getByRole("button", { name: "レッスンへ進む" }).click();
  const songSelect = page.locator('select[aria-label="曲を選択"]');
  await expect(songSelect.locator("option")).toHaveCount(3);
  await songSelect.selectOption({
    label: "Menuet in G — Johann Sebastian Bach (1685-1750)",
  });
  await expect(page.locator(".question")).toBeVisible({ timeout: 15_000 });
  await page.locator(".question button").first().click();
  await expect(page.locator(".question")).toContainText("どこから", {
    timeout: 15_000,
  });
  await page.locator(".question button").first().click();
  await expect(page.locator(".plan")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".state")).toContainText("demo", {
    timeout: 15_000,
  });
  await page.evaluate(() => window.__pianoCoach?.setTimeScale(100));
  await expect(
    page.getByRole("button", { name: "鍵盤を押してスタート" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.__pianoCoach?.pressKey(60));
  await page.waitForTimeout(2_000);
  await page.evaluate(() => {
    const api = window.__pianoCoach;
    const timeline = api?.getState().timeline;
    if (!api || !timeline)
      throw new Error("exercise timeline was not available");
    for (const note of timeline.notes) {
      api.pressKey(note.pitch);
      api.releaseKey(note.pitch);
    }
  });
  await expect(page.locator(".subtitle")).toContainText("よくできた", {
    timeout: 15_000,
  });
  await expect(page.locator(".state")).toContainText("briefing", {
    timeout: 15_000,
  });
});
