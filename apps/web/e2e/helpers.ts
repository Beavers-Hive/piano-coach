import { expect, type Page } from "@playwright/test";

/** 「前回の続きから始めますか？」のカード（再開カード）。 */
export function resumeCard(page: Page) {
  return page.getByRole("dialog", { name: "前回の続きから始めますか？" });
}

/**
 * 曲を選ぶ・PDF を渡すと、保存済みの進捗がある曲では再開カードが先に出る。
 * 先生の最初の質問（.question）・計画（.plan）・再開カードのどれかが出るのを待ち、カードなら「最初から」を押す。
 */
export async function startFromBeginning(page: Page, timeout = 30_000) {
  const card = resumeCard(page);
  await expect(
    card.or(page.locator(".question")).or(page.locator(".plan")).first(),
  ).toBeVisible({ timeout });
  if (await card.isVisible()) {
    await card.getByRole("button", { name: "最初から" }).click();
    await expect(card).toBeHidden({ timeout: 15_000 });
  }
}

/**
 * レッスン画面に入った直後に、再開カードが出ていたら「最初から」を押す
 * （曲の一覧が届くと、保存済みの進捗があるいちばん新しい曲について出る）。
 * 曲の一覧の取得を待ってから確かめる。
 */
export async function dismissEntryResume(page: Page) {
  await expect(
    page.locator('select[aria-label="曲を選択"] option'),
  ).not.toHaveCount(1, { timeout: 30_000 });
  const card = resumeCard(page);
  try {
    await card.waitFor({ state: "visible", timeout: 4_000 });
  } catch {
    return;
  }
  await card.getByRole("button", { name: "最初から" }).click();
  await expect(card).toBeHidden({ timeout: 15_000 });
}
