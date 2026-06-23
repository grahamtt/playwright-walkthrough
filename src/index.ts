import { test as base, expect } from '@playwright/test';
import { Walkthrough } from './walkthrough';

export { expect };
export { Walkthrough };
export { defineWalkthrough } from './config';
export type { WalkthroughOptions } from './config';
export { renderGuide, renderIndex } from './markdown';
export type {
  StepOptions, StepKind, IRStep, IRScreenshot, WalkthroughIR, Rect,
} from './types';

/**
 * The extended `test` with a `wt` fixture. Import this instead of
 * `@playwright/test`:
 *
 *   import { test, expect } from 'playwright-walkthrough';
 *
 *   test('...', { tag: '@walkthrough' }, async ({ page, wt }) => { ... });
 */
export const test = base.extend<{ wt: Walkthrough }>({
  wt: async ({ page }, use) => {
    const wt = new Walkthrough(page, base.info());
    await wt.begin();
    await use(wt);
    await wt.end();
  },
});
