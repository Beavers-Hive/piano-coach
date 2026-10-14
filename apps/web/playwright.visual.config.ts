import { defineConfig, devices } from "@playwright/test";

// 見た目の確認用（e2e/visual.spec.ts だけを実行する）。モックモードなのでサーバーは不要。
// 起動済みの vite（5173）があれば、それを使う。
export default defineConfig({
  testDir: "./e2e",
  testMatch: /visual\.spec\.ts/,
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    ...devices["Desktop Chrome"],
    launchOptions: { args: ["--use-angle=metal", "--enable-gpu"] },
  },
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
