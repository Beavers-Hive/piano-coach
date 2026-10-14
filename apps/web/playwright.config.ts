import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command:
        "PIANO_COACH_FAKE_BRAIN=1 PIANO_COACH_FAKE_TTS=1 uv run piano-coach-server",
      cwd: "../server",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
