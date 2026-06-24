import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
import type { ReporterOptions } from './reporter';

export interface WalkthroughOptions {
  /** Output root for guides + index.md (relative to cwd). Default: 'walkthroughs'. */
  outputDir?: string;
  /** Title for the generated index.md. */
  title?: string;
  /** Markdown rendering options. */
  markdown?: { toc?: boolean };
  /** Shared viewport for both projects. Default: 1280×800. */
  viewport?: { width: number; height: number };
}

type Config = PlaywrightTestConfig & { walkthrough?: WalkthroughOptions };

function normalizeReporter(r: PlaywrightTestConfig['reporter']): Array<[string] | [string, unknown]> {
  if (!r) return [['list']];
  if (typeof r === 'string') return [[r]];
  return r as Array<[string] | [string, unknown]>;
}

/**
 * Build a Playwright config wired for walkthroughs:
 *   - registers the WalkthroughReporter (auto-renders markdown on every run),
 *   - defines a `chromium` project (mode OFF) and a `walkthrough` project (mode ON),
 *   - selects `*.walkthrough.ts` files,
 *   - points the `wt` fixture at the same output dir via WT_OUT.
 *
 * Any standard Playwright config field passed in overrides the defaults.
 *
 *   // playwright.config.ts
 *   import { defineWalkthrough } from 'playwright-walkthrough/config';
 *   export default defineWalkthrough({ walkthrough: { title: 'My App Guides' } });
 */
export function defineWalkthrough(config: Config = {}): ReturnType<typeof defineConfig> {
  const { walkthrough = {}, reporter, projects, use, testMatch, ...rest } = config;

  const outputDir = resolve(process.cwd(), walkthrough.outputDir ?? 'walkthroughs');
  // The config file is evaluated in the main process AND every worker, so
  // setting the env var here is how the fixture (in workers) learns the dir.
  process.env.WT_OUT = outputDir;

  const viewport = walkthrough.viewport ?? { width: 1280, height: 800 };
  const reporterOptions: ReporterOptions = {
    outputDir,
    title: walkthrough.title ?? 'Walkthroughs',
    toc: walkthrough.markdown?.toc ?? false,
  };

  return defineConfig({
    testMatch: testMatch ?? '**/*.walkthrough.ts',
    use: { viewport, ...use },
    projects: projects ?? [
      { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
      { name: 'walkthrough', use: { ...devices['Desktop Chrome'], viewport } },
    ],
    ...rest,
    // Resolve the sibling reporter with the extension that matches how this
    // file is being executed: `.ts` when run from source (this package's own
    // dev), `.js` when run from the compiled `dist/` (installed consumers).
    reporter: [
      ...normalizeReporter(reporter),
      [join(__dirname, __filename.endsWith('.ts') ? 'reporter.ts' : 'reporter.js'), reporterOptions],
    ],
  });
}
