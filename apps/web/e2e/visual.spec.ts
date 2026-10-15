import { expect, test, type Page } from "@playwright/test";

// 見た目の確認用。モックモードで課題の説明画面を撮影する。
// あわせて、WebGL のシェーダーエラーがコンソールに出ていないことを検査する
// （手のシェーダーが二重定義でコンパイルに失敗し、手が表示されなかった不具合の再発防止）。

const SHOTS = "test-results/visual";

async function enterLesson(page: Page) {
  await page.goto("/?mock=1");
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500); // カメラの移動が落ち着くまで待つ
}

test("visual: briefing renders and allows replaying the demonstration", async ({
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
  ).toBeEnabled();

  expect(shaderErrors, shaderErrors.join("\n")).toEqual([]);
});

test("visual: score panel supports notes, score, and both modes", async ({
  page,
}) => {
  await enterLesson(page);
  await expect(page.getByTestId("score-panel")).toBeVisible();
  await expect(page.locator(".score-svg svg").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: `${SHOTS}/score-1-both.png` });

  await page.getByRole("button", { name: "楽譜" }).click();
  await expect(page.getByTestId("score-panel")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/score-2-score-only.png` });

  await page.getByRole("button", { name: "ノーツ" }).click();
  await expect(page.getByTestId("score-panel")).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/score-3-notes-only.png` });
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
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
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
  await shootUi(page, "ui-5-result-low-720", "ui=result,low", [3300], {
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

// 曲の導入。暗転 → 幕が上がる照明とともに「本日の曲」のカードが出て、約 4 秒で消える
test("visual ui: song intro title card", async ({ page }) => {
  await shootUi(page, "ui-9-title", "ui=title", [700, 1500, 2600, 3500, 5500]);
});

test("visual ui: song intro at 1280x720", async ({ page }) => {
  await shootUi(page, "ui-9-title-720", "ui=title", [2600], {
    width: 1280,
    height: 720,
  });
});

test("visual ui: count-in at 1280x720", async ({ page }) => {
  await shootUi(page, "ui-4-countin-720", "ui=countin", [2520], {
    width: 1280,
    height: 720,
  });
});

// 再開カード（?mock=1&ui=resume）。準備画面を終えた直後に「前回の続きから」を尋ねる
test("visual ui: resume prompt", async ({ page }) => {
  await shootUi(page, "ui-10-resume", "ui=resume", [1500]);
  // 既定のフォーカスは「続きから」。Esc では閉じない
  await expect(page.getByRole("button", { name: "続きから" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  // Tab で「最初から」へ。フォーカスリングを撮る
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "最初から" })).toBeFocused();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/ui-10-resume-focus-secondary.png` });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "続きから" })).toBeFocused();
  // 「続きから」で閉じ、曲のタイトルカードの下の行に「前回の続きから」が出る
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".song-intro-resume")).toBeVisible({
    timeout: 5_000,
  });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${SHOTS}/ui-10-resume-intro.png` });
});

test("visual ui: resume prompt at 1280x720", async ({ page }) => {
  await shootUi(page, "ui-10-resume-720", "ui=resume", [1500], {
    width: 1280,
    height: 720,
  });
});

// ---- お手本のカメラ（scene/demoCamera.ts）。時計を止めて、時刻ごとの構図を撮る ----
// demoCameraAt は時刻の純粋関数で、手のポーズも時刻の純粋関数なので、再生位置を固定すれば同じ絵が撮れる。
// 運指のイベントを含む課題は public/mock/timeline-*.json（サーバーの ExerciseBuilder が作った timeline に、撮影用に events を足したもの）。

async function startDemoWith(
  page: Page,
  timelineFile: string,
  withEvents = true,
) {
  await page.goto("/?mock=1&demo=1");
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator(".state")).toContainText("demo");
  await page.evaluate(
    async ({ file, withEvents }) => {
      const timeline = await (await fetch(file)).json();
      if (!withEvents) {
        timeline.fingeringEvents = [];
        // 巡回の全体（約 18 秒）を見るため、課題を 3 回くり返して長くする
        const notes = timeline.notes;
        timeline.notes = [0, 1, 2].flatMap((k) =>
          notes.map((n: { playId: string; startMs: number }) => ({
            ...n,
            playId: `${n.playId}@${k}`,
            startMs: n.startMs + k * 10500,
          })),
        );
      }
      window.__pianoCoach!.getState().set({ timeline });
      dispatchEvent(new CustomEvent("piano-demo"));
    },
    { file: timelineFile, withEvents },
  );
  await page.waitForTimeout(300);
}

/** お手本の時計を止めて、playhead を ms に固定する（カメラはそこへ追いつく）。 */
async function freezePlayhead(page: Page, ms: number) {
  await page.evaluate(async (t) => {
    const path = "/src/midi/clock.ts";
    const clock = await import(/* @vite-ignore */ path);
    clock.startClock(t);
    clock.pauseClock();
  }, ms);
  await page.waitForTimeout(1500);
}

async function shootDemoCamera(
  page: Page,
  timelineFile: string,
  prefix: string,
  times: number[],
  withEvents = true,
) {
  await startDemoWith(page, timelineFile, withEvents);
  let index = 0;
  for (const ms of times) {
    await freezePlayhead(page, ms);
    await page.screenshot({
      path: `${SHOTS}/${prefix}-${String.fromCharCode(97 + index)}.png`,
    });
    index += 1;
  }
}

test("visual: demo camera (right hand, with events)", async ({ page }) => {
  await shootDemoCamera(
    page,
    "/mock/timeline-minuet-right.json",
    "demo-cam",
    [0, 1800, 3300, 4200, 5300, 6400, 7900, 9000],
  );
});

// 運指のイベントがない区間は、手前 → 右斜め → 真上 → 左斜め → 横（親指側）を、数秒ごとに巡回する
test("visual: demo camera cycle (no events)", async ({ page }) => {
  await shootDemoCamera(
    page,
    "/mock/timeline-minuet-right.json",
    "demo-cycle",
    [1000, 2800, 4600, 8200, 11800, 15400, 17200, 19000],
    false,
  );
});

// 両手・左手の課題でも、手と鍵盤が収まる
test("visual: demo camera (both hands)", async ({ page }) => {
  await shootDemoCamera(
    page,
    "/mock/timeline-minuet-both.json",
    "demo-both",
    [500, 2500, 4300, 5800, 7500, 9500, 11800, 15000],
  );
});

test("visual: demo camera (left hand)", async ({ page }) => {
  await shootDemoCamera(
    page,
    "/mock/timeline-minuet-left.json",
    "demo-left",
    [500, 2500, 4500, 7000, 8200, 9600, 11800, 15000],
  );
});

// 基礎練習（スケール）。サーバーの ExerciseBuilder が、親指くぐりの events を付ける
test("visual: demo camera (scale drill)", async ({ page }) => {
  await shootDemoCamera(
    page,
    "/mock/timeline-scale-drill.json",
    "demo-scale",
    [500, 1700, 2900, 4000, 5000, 6200, 8000, 9500],
  );
});

// お手本を実時間で再生する。途中の構図が動き、終わったら既存のプリセット（play）へ戻る
test("visual: demo camera live, then returns to the preset", async ({
  page,
}) => {
  await page.goto("/?mock=1&demo=1");
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator(".state")).toContainText("demo");
  const started = Date.now();
  const shoot = async (name: string, atMs: number) => {
    await page.waitForTimeout(Math.max(0, atMs - (Date.now() - started)));
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  await shoot("demo-live-a", 1500);
  await shoot("demo-live-b", 3500);
  await shoot("demo-live-c", 5500);
  await shoot("demo-live-d", 7500);
  await page.waitForFunction(
    () => window.__pianoCoach?.getState().lessonState !== "demo",
    undefined,
    { timeout: 20_000 },
  );
  // お手本が終わった直後（約 0.8 秒かけて戻っている途中）と、戻りきったあと
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/demo-live-e.png` });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/demo-live-f.png` });
});

// cameraAuto を false にすると、お手本のあいだも、プリセット（play）の固定のカメラのまま
test("visual: demo camera can be turned off (cameraAuto)", async ({ page }) => {
  await page.goto("/?mock=1&demo=1");
  await page.getByRole("button", { name: /音声を有効/ }).click();
  await page.getByRole("button", { name: /レッスンへ進む/ }).click();
  await expect(page.locator(".state")).toContainText("demo");
  await page.evaluate(() =>
    window.__pianoCoach!.getState().set({ cameraAuto: false }),
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/demo-fixed-a.png` });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/demo-fixed-b.png` });
});

test("visual: generation indicator distinguishes response and voice waits", async ({
  page,
}) => {
  await enterLesson(page);
  await page.evaluate(() =>
    window.__pianoCoach!.getState().set({ generation: "thinking" }),
  );
  await expect(
    page.getByText("先生が考えています", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "鍵盤を押してスタート" }),
  ).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/generation-thinking.png` });
  await page.evaluate(() =>
    window.__pianoCoach!.getState().set({ generation: "voice" }),
  );
  await expect(
    page.getByText("先生の声を準備しています", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.__pianoCoach!.getState().set({ generation: null }),
  );
  await expect(page.locator(".generation-status")).toBeHidden();
});

test("visual: demonstration can be replayed twice without advancing the lesson", async ({
  page,
}) => {
  await enterLesson(page);
  const version = await page.evaluate(
    () => window.__pianoCoach!.getState().timeline!.exerciseVersion,
  );
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByRole("button", { name: "お手本を再生" }).click();
    await expect(page.locator(".state")).toContainText("demo");
    await page.evaluate(() => window.__pianoCoach!.setTimeScale(30));
    await expect(
      page.getByRole("button", { name: "お手本を再生" }),
    ).toBeEnabled({ timeout: 15000 });
    expect(
      await page.evaluate(
        () => window.__pianoCoach!.getState().timeline!.exerciseVersion,
      ),
    ).toBe(version);
    await expect(page.locator(".state")).toContainText("briefing");
  }
});

// ---- 3D の手（WebXR generic-hand）の撮影。カメラを固定して、近い距離と遠い距離から、複数の瞬間を撮る ----
// 手のモデルの確認用。両手の課題で、右手・左手・親指くぐりの瞬間を、手首のスリーブも含めて撮る。
// ?mock=1 のとき、Hands.tsx が window.__handShot を公開する（cam = [x, y, z, 注視点 x, y, z]）。
test("visual: hands closeups (both hands, near and far)", async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Shader Error|WebGLProgram|not compiled/i.test(text))
      shaderErrors.push(text.slice(0, 300));
  });
  await startDemoWith(page, "/mock/timeline-minuet-both.json");
  // UI を隠して、3D だけを撮る
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    let node: HTMLElement | null = canvas;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (parent)
        for (const sibling of Array.from(parent.children) as HTMLElement[])
          if (sibling !== node && !sibling.contains(canvas))
            sibling.style.display = "none";
      node = parent;
    }
    window.__pianoCoach!.getState().set({ cameraAuto: false });
  });
  const cams: Record<string, number[]> = {
    near: [0.03, 0.2, 0.4, 0.0, 0.03, 0.08],
    top: [0.0, 0.5, 0.25, 0.0, 0.03, 0.1],
    far: [0.0, 0.42, 0.62, 0.0, 0.03, 0.05],
    side: [0.3, 0.14, 0.3, 0.0, 0.05, 0.1],
  };
  let index = 0;
  for (const ms of [1200, 4300, 7500]) {
    await freezePlayhead(page, ms);
    for (const [name, cam] of Object.entries(cams)) {
      await page.evaluate((value) => {
        (
          window as unknown as { __handShot: { cam: number[] } }
        ).__handShot.cam = value;
      }, cam);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${SHOTS}/hands-${String.fromCharCode(97 + index)}-${name}.png`,
      });
    }
    index += 1;
  }
  expect(shaderErrors, shaderErrors.join("\n")).toEqual([]);
});
