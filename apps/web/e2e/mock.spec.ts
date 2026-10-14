import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("mock mode renders a non-black WebGL piano scene", async ({ page }) => {
  await page.goto("/?mock=1");
  await page.getByRole("button", { name: "音声を有効にして準備する" }).click();
  await page.getByRole("button", { name: "レッスンへ進む" }).click();
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const image = PNG.sync.read(await canvas.screenshot());
  const brightness = image.data.reduce(
    (sum, value, index) => (index % 4 === 3 ? sum : sum + value),
    0,
  );
  expect(brightness).toBeGreaterThan(10_000);
});
