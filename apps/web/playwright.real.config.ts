import { defineConfig, devices } from "@playwright/test";

// 本物の Claude と Irodori での通しテスト（e2e/real.spec.ts）。起動済みのサーバーを使う。
//   1. TTS:    cd vendor/Irodori-TTS && HF_HUB_DISABLE_IMPLICIT_TOKEN=1 uv run --no-sync python ../../tts/server.py
//   2. server: cd apps/server && uv run piano-coach-server（フェイクの環境変数なし）
//   3. PIANO_COACH_REAL=1 npx playwright test -c playwright.real.config.ts
export default defineConfig({
  testDir: "./e2e",
  testMatch: /real\.spec\.ts/,
  workers: 1,
  // フェイクの E2E を流しても消えないよう、結果は別のフォルダに残す
  outputDir: "test-results-real/artifacts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
