import { defineWalkthrough } from './src/config';

/**
 * Walkthrough-wired Playwright config (see src/config.ts).
 *   - `chromium` project    → every test, mode OFF (ordinary tests, zero artifacts)
 *   - `walkthrough` project → only `@walkthrough`-tagged tests, mode ON (captures
 *                              IR + screenshots; the reporter renders
 *                              walkthrough.md + index.md on every run)
 */
export default defineWalkthrough({
  testDir: 'examples',
  walkthrough: {
    outputDir: 'walkthroughs',
    title: 'Trac Walkthroughs',
  },
});
