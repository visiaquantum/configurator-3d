import { defineConfig, devices } from '@playwright/test'

// End-to-end checks of the manual integration page (`tests/browser`), with
// WebGL rendered in software so they also run on CI machines without a GPU.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  }],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/tests/browser/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
