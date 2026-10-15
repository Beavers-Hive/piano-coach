import { expect, test } from "@playwright/test";

// PC キーボードで鍵盤を弾く機能が、Cmd/Ctrl を押したショートカットを握りつぶさないこと。
// （以前は F キーを無条件に横取りし、Cmd+Shift+F の全画面がブラウザに届かなかった）
test("modifier shortcuts are not swallowed as piano notes", async ({
  page,
}) => {
  await page.goto("/?mock=1");
  await page.waitForFunction(() => Boolean(window.__pianoCoach));

  // Cmd+Shift+F は、アプリの全画面の切り替えとして処理され（既定動作を止める）、鍵盤は鳴らない
  await page.evaluate(() => {
    (window as unknown as { __keyLog: boolean[] }).__keyLog = [];
    addEventListener("keydown", (event) => {
      (window as unknown as { __keyLog: boolean[] }).__keyLog.push(
        event.defaultPrevented,
      );
    });
  });
  await page.keyboard.press("Meta+Shift+F");
  expect(
    await page.evaluate(() => window.__pianoCoach?.getState().pressed.size),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __keyLog: boolean[] }).__keyLog.pop(),
    ),
  ).toBe(true);

  // Ctrl+F、Cmd+R のように、修飾キー付きの F・R は鍵盤を鳴らさず、ブラウザの動作も止めない
  await page.keyboard.press("Control+F");
  expect(
    await page.evaluate(() => window.__pianoCoach?.getState().pressed.size),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __keyLog: boolean[] }).__keyLog.pop(),
    ),
  ).toBe(false);

  // 修飾キーなしの F は、これまでどおり鍵盤（F4 = 65）を弾く
  await page.keyboard.down("f");
  expect(
    await page.evaluate(() => window.__pianoCoach?.getState().pressed.has(65)),
  ).toBe(true);
  await page.keyboard.up("f");
  expect(
    await page.evaluate(() => window.__pianoCoach?.getState().pressed.has(65)),
  ).toBe(false);
});
