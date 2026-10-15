import { defineConfig, devices } from "@playwright/test";

// 実際の Gemini / Cloud TTS を使う。公開URLは PIANO_COACH_BASE_URL で指定。
const remoteURL = process.env.PIANO_COACH_BASE_URL;
export default defineConfig({
  testDir: "./e2e",
  testMatch: remoteURL ? /cloud\.spec\.ts/ : /real\.spec\.ts/,
  workers: 1,
  // フェイクの E2E を流しても消えないよう、結果は別のフォルダに残す
  outputDir: "test-results-real/artifacts",
  use: {
    channel: process.env.PIANO_COACH_BROWSER_CHANNEL,
    baseURL: remoteURL || "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    ...devices["Desktop Chrome"],
  },
  webServer: remoteURL
    ? undefined
    : {
        command: "npm run dev -- --port 5173",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
