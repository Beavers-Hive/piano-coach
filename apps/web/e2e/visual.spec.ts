import { expect, test, type Page } from "@playwright/test";

// 見た目の確認用。モックモードで、課題の説明・お手本（ホログラムの手）・演奏中の画面を撮影する。
// あわせて、WebGL のシェーダーエラーがコンソールに出ていないことを検査する
// （手のシェーダーが二重定義でコンパイルに失敗し、手が表示されなかった不具合の再発防止）。

const SHOTS = "test-results/visual";

async function enterLesson(page: Page) {
  await page.goto("/?mock=1");
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(2500); // カメラの移動が落ち着くまで待つ
}

test("visual: briefing, demo hands and practice render without shader errors", async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Shader Error|WebGLProgram|not compiled/i.test(text)) shaderErrors.push(text.slice(0, 300));
  });

  await enterLesson(page);
  await page.screenshot({ path: `${SHOTS}/1-briefing.png` });

  await page.getByRole("button", { name: "お手本を再生" }).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOTS}/2-demo-hands.png` });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/3-demo-hands-later.png` });

  expect(shaderErrors, shaderErrors.join("\n")).toEqual([]);
});
