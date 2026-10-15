import { expect, test, type Page } from "@playwright/test";

// 見た目の確認用。モックモードで課題の説明画面を撮影する。
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

test("visual: briefing renders and does not allow a manual demo", async ({
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

  await expect(
    page.getByRole("button", { name: "お手本を再生" }),
  ).toBeDisabled();

  expect(shaderErrors, shaderErrors.join("\n")).toEqual([]);
});

// サーバーが始めたお手本と同じ状態（?mock=1&demo=1）で、ホログラムの手を撮影する。
// 手の描画は WebGL の画素でしか確認できないので、撮影した画像を目視で確認する（test-results/visual/）。
test("visual: demo hands render without shader errors", async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Shader Error|WebGLProgram|not compiled/i.test(text))
      shaderErrors.push(text.slice(0, 300));
  });
  await page.goto("/?mock=1&demo=1");
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator(".state")).toContainText("demo");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/2-demo-hands.png` });
  expect(
    await page.evaluate(() => window.__pianoCoach?.getState().handsMode),
  ).toBe("demo");
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

// ---- UI（HUD、ダイアログ、準備画面など）の撮影。?mock=1&ui=… で状態を再現する ----

async function shootUi(
  page: Page,
  name: string,
  query: string,
  waits: number[] = [2800],
  viewport?: { width: number; height: number },
) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`/?mock=1&${query}`);
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator("canvas")).toBeVisible();
  let elapsed = 0;
  let index = 0;
  for (const at of waits) {
    await page.waitForTimeout(Math.max(0, at - elapsed));
    elapsed = at;
    const suffix =
      waits.length > 1 ? `-${String.fromCharCode(97 + index)}` : "";
    await page.screenshot({ path: `${SHOTS}/${name}${suffix}.png` });
    index += 1;
  }
}

test("visual ui: setup screen", async ({ page }) => {
  await page.goto("/?mock=1");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/ui-0-setup.png` });
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await expect(
    page.getByRole("button", { name: /レッスンへ進む/ }),
  ).toBeEnabled({
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/ui-0-setup-ready.png` });
});

test("visual ui: dialogue typewriter", async ({ page }) => {
  await shootUi(page, "ui-1-dialogue", "ui=dialogue", [1500, 5500]);
});

test("visual ui: dialogue at 1280x720", async ({ page }) => {
  await shootUi(page, "ui-1-dialogue-720", "ui=dialogue,plan", [6500], {
    width: 1280,
    height: 720,
  });
});

test("visual ui: question card", async ({ page }) => {
  await shootUi(page, "ui-2-question", "ui=question", [2800]);
  await page.locator(".q-option").nth(1).hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/ui-2-question-hover.png` });
});

test("visual ui: question card at 1280x720", async ({ page }) => {
  await shootUi(page, "ui-2-question-720", "ui=question", [2800], {
    width: 1280,
    height: 720,
  });
});

test("visual ui: plan roadmap", async ({ page }) => {
  await shootUi(page, "ui-3-plan", "ui=plan,dialogue", [6500]);
});

test("visual ui: count-in", async ({ page }) => {
  await shootUi(page, "ui-4-countin", "ui=countin", [2400, 2520, 2700]);
});

test("visual ui: result card", async ({ page }) => {
  await shootUi(page, "ui-5-result", "ui=result", [1100, 1700, 3300]);
});

test("visual ui: result card (low score) at 1280x720", async ({ page }) => {
  await shootUi(page, "ui-5-result-low-720", "ui=result,low", [4300], {
    width: 1280,
    height: 720,
  });
});

test("visual ui: drill badge and toast", async ({ page }) => {
  await shootUi(page, "ui-6-drill", "ui=drill,error", [6500]);
});

test("visual ui: briefing (start button) at 1280x720", async ({ page }) => {
  await shootUi(page, "ui-7-briefing-720", "ui=dialogue", [6500], {
    width: 1280,
    height: 720,
  });
});

test("visual ui: playing (status chip, combo)", async ({ page }) => {
  await shootUi(page, "ui-8-playing", "ui=playing", [3200]);
});
