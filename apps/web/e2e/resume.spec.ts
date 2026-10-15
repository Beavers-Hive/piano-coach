import { expect, test, type Page } from "@playwright/test";
import { dismissEntryResume, resumeCard, startFromBeginning } from "./helpers";

// 途中からの再開（ローカル保存）。フェイクのサーバーで、ヒアリング → 計画 → 最初の課題まで進め、
// ページを開き直すと再開カードが出る。「続きから」ならヒアリングを飛ばし、「最初から」ならヒアリングが始まる。
// サーバーは進捗を data-e2e/ に保存する（playwright.config.ts が起動時に消す）。

const SONG = "メヌエット ト長調 — ペツォールト（伝 J.S.バッハ）";

async function enterLesson(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "音声を有効にして準備する" }).click();
  await page.getByRole("button", { name: "レッスンへ進む" }).click();
  await expect(
    page.locator('select[aria-label="曲を選択"] option'),
  ).toHaveCount(3, { timeout: 30_000 });
}

/** ヒアリングに答えて計画を作り、最初の課題（鍵盤を押してスタート）が出るところまで進める。 */
async function buildProgress(page: Page) {
  await enterLesson(page);
  await dismissEntryResume(page);
  await page.locator('select[aria-label="曲を選択"]').selectOption({
    label: SONG,
  });
  await startFromBeginning(page, 15_000);
  await expect(page.locator(".question")).toBeVisible({ timeout: 15_000 });
  await page.locator(".question button").first().click();
  await expect(page.locator(".question")).toContainText("どこから", {
    timeout: 15_000,
  });
  await page.locator(".question button").first().click();
  await expect(page.locator(".plan")).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.__pianoCoach?.setTimeScale(100));
  await expect(
    page.getByRole("button", { name: "鍵盤を押してスタート" }),
  ).toBeVisible({ timeout: 15_000 });
}

test("reload shows the resume card, and 続きから skips the hearing", async ({
  page,
}) => {
  await buildProgress(page);

  // 開き直す。曲の一覧が届くと、保存済みの進捗がある曲について再開カードが出る
  await enterLesson(page);
  const card = resumeCard(page);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("メヌエット ト長調");
  await expect(card).toContainText("本日のプログラム");
  await expect(card).toContainText(/\d+ \/ \d+/);
  // 既定のフォーカスは「続きから」。Esc では閉じない
  await expect(card.getByRole("button", { name: "続きから" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "続きから" }).click();
  await expect(card).toBeHidden({ timeout: 15_000 });
  // ヒアリングは飛ばして、保存した計画と課題から始まる
  await expect(page.locator(".plan")).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "鍵盤を押してスタート" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".question")).toHaveCount(0);
});

test("reload shows the resume card, and 最初から starts the hearing", async ({
  page,
}) => {
  await buildProgress(page);

  await enterLesson(page);
  const card = resumeCard(page);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "最初から" }).click();
  await expect(card).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".question")).toBeVisible({ timeout: 15_000 });
});

test("choosing a song with saved progress asks before starting", async ({
  page,
}) => {
  await buildProgress(page);
  await enterLesson(page);
  await resumeCard(page).getByRole("button", { name: "最初から" }).click();
  await expect(page.locator(".question")).toBeVisible({ timeout: 15_000 });

  // レッスン中（ヒアリング中）に、保存済みの曲を選ぶと、またカードが出る
  await page.locator('select[aria-label="曲を選択"]').selectOption({
    label: SONG,
  });
  await expect(resumeCard(page)).toBeVisible({ timeout: 15_000 });
});
