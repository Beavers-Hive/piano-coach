import path from "node:path";
import { expect, test } from "@playwright/test";

// デモの最初の見せ場「PDF を渡すだけ」: PDF を選ぶと、曲が読み込まれて先生のヒアリングが始まる。
test("uploading the Minuet PDF starts the lesson", async ({ page }) => {
  // E2E は apps/web から実行される（ESM なので __dirname は使えない）
  const pdf = path.resolve(
    process.cwd(),
    "../../assets/scores/minuet-g/anna-magdalena-04-a4.pdf",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "音声を有効にして準備する" }).click();
  await page.getByRole("button", { name: "レッスンへ進む" }).click();
  await page.locator('input[type="file"]').setInputFiles(pdf);
  await expect(page.locator(".question")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".state")).toContainText("hearing");
});
