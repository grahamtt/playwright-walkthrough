import { defineWalkthrough } from './src/config';

/**
 * Walkthrough-wired Playwright config (see src/config.ts).
 *   - `chromium` project    → mode OFF (ordinary tests, zero artifacts)
 *   - `walkthrough` project → mode ON  (captures IR + screenshots; the reporter
 *                              renders walkthrough.md + index.md on every run)
 */
export default defineWalkthrough({
  walkthrough: {
    outputDir: 'walkthroughs',
    title: 'Trac Walkthroughs',
  },
});
