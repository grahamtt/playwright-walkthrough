import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
import type { WalkthroughTestOptions } from './types';
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
  /** The tag that opts a test into becoming a guide. Default: '@walkthrough'. */
  tag?: string;
}

type TestConfig = PlaywrightTestConfig<Partial<WalkthroughTestOptions>>;
type Config = TestConfig & { walkthrough?: WalkthroughOptions };

function normalizeReporter(r: PlaywrightTestConfig['reporter']): Array<[string] | [string, unknown]> {
  if (!r) return [['list']];
  if (typeof r === 'string') return [[r]];
  return r as Array<[string] | [string, unknown]>;
}

/** Match `tag` as a whole tag, so '@walkthrough' doesn't also select '@walkthrough-draft'. */
export function tagPattern(tag: string): RegExp {
  return new RegExp(`${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
}

/**
 * Build a Playwright config wired for walkthroughs:
 *   - registers the WalkthroughReporter (auto-renders markdown on every run),
 *   - defines a `chromium` project (every test, mode OFF) and a `walkthrough`
 *     project (only tests tagged `@walkthrough`, mode ON),
 *   - leaves `testMatch` alone, so guides live in ordinary spec files,
 *   - points the `wt` fixture at the same output dir via WT_OUT.
 *
 * Any standard Playwright config field passed in overrides the defaults. If you
 * pass your own `projects`, add a walkthrough project yourself:
 *   { name: 'walkthrough', grep: tagPattern('@walkthrough'), use: { walkthroughMode: true } }
 *
 *   // playwright.config.ts
 *   import { defineWalkthrough } from 'playwright-walkthrough/config';
 *   export default defineWalkthrough({ walkthrough: { title: 'My App Guides' } });
 */
export function defineWalkthrough(config: Config = {}): TestConfig {
  const { walkthrough = {}, reporter, projects, use, ...rest } = config;

  const outputDir = resolve(process.cwd(), walkthrough.outputDir ?? 'walkthroughs');
  // The config file is evaluated in the main process AND every worker, so
  // setting the env var here is how the fixture (in workers) learns the dir.
  process.env.WT_OUT = outputDir;

  const tag = walkthrough.tag ?? '@walkthrough';
  const viewport = walkthrough.viewport ?? { width: 1280, height: 800 };
  const reporterOptions: ReporterOptions = {
    outputDir,
    title: walkthrough.title ?? 'Walkthroughs',
    toc: walkthrough.markdown?.toc ?? false,
  };

  return defineConfig<Partial<WalkthroughTestOptions>>({
    use: { viewport, walkthroughTag: tag, ...use },
    projects: projects ?? [
      { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
      {
        name: 'walkthrough',
        grep: tagPattern(tag),
        use: { ...devices['Desktop Chrome'], viewport, walkthroughMode: true },
      },
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
