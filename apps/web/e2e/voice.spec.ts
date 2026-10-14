import { expect, test } from "@playwright/test";

// 準備画面の「先生の声をテスト」が、サーバーの POST /api/voice/test（Irodori 経由）を使い、
// どちらの声で鳴ったかを表示することを確認する。
// E2E のサーバーはフェイクの TTS（url = null）で起動するので、代替音声の警告が出るのが正しい。
test("voice test goes through the server and reports the engine", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/voice/test")) requests.push(request.method());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "先生の声をテスト" }).click();
  await expect(page.getByText("Irodori に接続できていません（ブラウザの音声で代替中）")).toBeVisible();
  expect(requests).toEqual(["POST"]);
  await expect(page.getByText("Irodori（先生の声）")).toBeVisible();
});
