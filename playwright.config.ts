import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173/SurveyViewerV2/';
const channel = process.env.SURVEY_CHROME_CHANNEL;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  retries: 0,
  use: { baseURL, channel },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --base /SurveyViewerV2/',
    url: baseURL,
  },
});
