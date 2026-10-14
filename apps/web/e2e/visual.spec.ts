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

test("visual: briefing, demo hands and practice render without shader errors", async ({
  page,
}) => {
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Shader Error|WebGLProgram|not compiled/i.test(text))
      shaderErrors.push(text.slice(0, 300));
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

// 楽譜を読み込むときの演出（?mock=1&import=1 で、約 8 秒の importing → analyzing → hearing を再現する）
test("visual: score import shows floating pages and light particles", async ({
  page,
}) => {
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Shader Error|WebGLProgram|not compiled/i.test(text))
      shaderErrors.push(text.slice(0, 300));
  });

  await page.goto("/?mock=1&import=1");
  await page.getByRole("button", { name: /音声を有効/ }).click();
  const started = Date.now();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator("canvas")).toBeVisible();
  const shoot = async (name: string, atMs: number) => {
    await page.waitForTimeout(Math.max(0, atMs - (Date.now() - started)));
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  await shoot("0-import-0-appear", 1150);
  await shoot("0-import-a-pages", 1800);
  await shoot("0-import-b-particles", 3600);
  await shoot("0-import-c-notes-forming", 5000);
  await shoot("0-import-d-formed", 7000);
  await shoot("0-import-e-fading", 8700);
  await shoot("0-import-f-done", 10500);

  expect(shaderErrors, shaderErrors.join("\n")).toEqual([]);
});
