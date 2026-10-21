import { test as base, expect } from '@playwright/test';
import { Walkthrough } from './walkthrough';

export { expect };
export { Walkthrough };
export { defineWalkthrough } from './config';
export type { WalkthroughOptions } from './config';
export { renderGuide, renderIndex } from './markdown';
import type { WalkthroughTestOptions } from './types';
export type {
  StepOptions, StepKind, IRStep, IRScreenshot, WalkthroughIR, Rect, WalkthroughTestOptions,
} from './types';

/**
 * The extended `test` with a `wt` fixture. Use it as-is, or merge it into a
 * suite's own `test` so every spec keeps a single import:
 *
 *   import { mergeTests } from '@playwright/test';
 *   import { test as walkthroughTest } from 'playwright-walkthrough';
 *   export const test = mergeTests(appTest, walkthroughTest);
 *
 * Any test may use `wt`; only tests tagged `@walkthrough` become guides, and
 * only when walkthrough mode is on.
 */
export const test = base.extend<WalkthroughTestOptions & { wt: Walkthrough }>({
  walkthroughMode: [false, { option: true }],
  walkthroughTag: ['@walkthrough', { option: true }],
  wt: async ({ page, walkthroughMode, walkthroughTag }, use, testInfo) => {
    const mode = walkthroughMode || process.env.WT === '1';
    const wt = new Walkthrough(page, testInfo, mode && testInfo.tags.includes(walkthroughTag));
    await wt.begin();
    await use(wt);
    await wt.end();
  },
});
