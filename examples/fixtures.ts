import { mergeTests, test as base } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { test as walkthroughTest } from '../src';
import { ProjectsPage } from './pages/projects-page';

export { expect } from '@playwright/test';

// The fixtures an existing suite already has.
const appTest = base.extend<{ appUrl: string }>({
  appUrl: pathToFileURL(join(__dirname, 'app', 'index.html')).href,
});

// Merge in `wt` once, here, so every spec keeps importing `test` from this file.
export const test = mergeTests(appTest, walkthroughTest).extend<{ projects: ProjectsPage }>({
  projects: async ({ page, wt, appUrl }, use) => {
    await use(new ProjectsPage(page, wt, appUrl));
  },
});
