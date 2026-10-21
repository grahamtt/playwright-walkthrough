# playwright-walkthrough

Turn your Playwright functional tests into user-facing walkthroughs — **markdown guides with annotated screenshots** — without maintaining a second suite of "documentation tests."

A walkthrough is an ordinary Playwright test with a `@walkthrough` tag. It lives in your normal spec files, uses the same `test` import and fixtures as the rest of your suite, and still navigates, acts and asserts. When run in walkthrough mode it *also* injects an in-page overlay that highlights each target and renders narration, captures a screenshot per step, and a reporter stitches everything into `walkthrough.md` files plus a top-level `index.md`. Run normally, it produces **zero artifacts** and its narration shows up only as named steps in Playwright's report and trace.

Which tests become guides is decided by the tag alone, not by file names, a separate import or a separate config, so narrated helpers can be used anywhere (including page objects) without turning every test into a guide.

## Install

```sh
npm install --save-dev playwright-walkthrough @playwright/test
```

`@playwright/test` is a peer dependency (>= 1.49). Requires Node >= 18.

## Quick start

**1. Wire up your Playwright config** with `defineWalkthrough`, which registers the reporter and defines two projects — `chromium` (every test, mode off) and `walkthrough` (only `@walkthrough`-tagged tests, mode on, captures artifacts):

```ts
// playwright.config.ts
import { defineWalkthrough } from 'playwright-walkthrough/config';

export default defineWalkthrough({
  walkthrough: {
    outputDir: 'walkthroughs', // where guides + index.md are written
    title: 'My App Guides',
  },
});
```

**2. Tag a test and narrate it.** Use the `test` from `playwright-walkthrough` (or merge it into your own — see below); it adds a `wt` fixture for narration and capture:

```ts
// tests/projects.spec.ts
import { test, expect } from 'playwright-walkthrough';

test('Create your first project', { tag: '@walkthrough' }, async ({ page, wt }) => {
  await wt.intro('Creating a project', 'A short guide to setting up your first project.');

  await wt.step('Open your dashboard', () => page.goto('http://localhost:3000'));

  await wt.act('Click **New Project** in the top bar',
    page.getByRole('button', { name: 'New Project' }),
    (l) => l.click());

  await wt.act('Give your project a **name**',
    page.getByLabel('Project name'),
    (l) => l.fill('Website redesign'));

  await wt.note('Your new project now appears in your list.');

  // Still a genuine assertion — this remains a real functional test.
  await expect(page.getByText('Website redesign')).toBeVisible();

  await wt.outro("That's it — you've created your first project.");
});
```

Test files are matched by Playwright's usual `testMatch`; tagged tests can sit next to untagged ones in the same file.

**3. Generate the guides:**

```sh
npx playwright test --project=walkthrough
# 📖 Walkthroughs: 1 generated → walkthroughs/index.md
```

Run the whole suite as plain tests (no artifacts) with `--project=chromium`.

## Adding walkthroughs to an existing suite

Most suites already have their own `test` with custom fixtures. Merge the walkthrough fixture into it once, so every spec keeps a single import:

```ts
// tests/fixtures.ts
import { mergeTests } from '@playwright/test';
import { test as walkthroughTest } from 'playwright-walkthrough';
import { test as appTest } from './app-fixtures';

export const test = mergeTests(appTest, walkthroughTest);
export { expect } from '@playwright/test';
```

To keep test bodies identical whether or not they become guides, put the narration in your page objects. The `wt` helpers run the same actions either way:

```ts
export class ProjectsPage {
  constructor(private page: Page, private wt: Walkthrough) {}

  async create(name: string) {
    await this.wt.act('Click **New Project** in the top bar',
      this.page.getByRole('button', { name: 'New Project' }), (l) => l.click());
    await this.wt.act('Give your project a **name**',
      this.page.getByLabel('Project name'), (l) => l.fill(name));
  }
}

// Becomes a guide.
test('Creating a project', { tag: '@walkthrough' }, async ({ projects }) => {
  await projects.create('Website redesign');
});

// Written the same way; never becomes a guide.
test('rejects duplicate names', async ({ projects }) => { /* ... */ });
```

A complete version is in [`examples/`](examples/) (`fixtures.ts`, `pages/projects-page.ts`, `projects.spec.ts`).

## Authoring API (the `wt` fixture)

| Method | Purpose |
| --- | --- |
| `wt.intro(title, description?)` | Guide front matter: title + lead paragraph. |
| `wt.step(narration, fn, opts?)` | A narrated step with no single target (navigation, multi-element actions). Captures after `fn` runs. |
| `wt.act(narration, locator, fn, opts?)` | Narrated step bound to a locator: highlights it, then runs `fn(locator)`. Captures before by default. |
| `wt.check(narration, fn, opts?)` | Visualize an assertion: run it, then capture the asserted state. |
| `wt.note(text, opts?)` | Pure narration block; captures a screenshot only if asked. |
| `wt.screenshot(narration?, opts?)` | Capture the current state on demand. |
| `wt.outro(text)` | Closing narration. |

Narration accepts inline markdown (e.g. `**bold**`). `StepOptions.screenshot` controls capture timing — `'before' | 'after' | 'both' | 'none'`.

`wt.step`, `wt.act` and `wt.check` also report themselves as a `test.step` titled with the narration, in both modes, so they show up in the HTML report and trace of every test that uses them.

## Configuration

`defineWalkthrough(config)` accepts any standard Playwright config field (which override the defaults) plus a `walkthrough` block:

| Option | Default | Description |
| --- | --- | --- |
| `walkthrough.outputDir` | `'walkthroughs'` | Output root for guides + `index.md` (relative to cwd). |
| `walkthrough.title` | `'Walkthroughs'` | Title for the generated `index.md`. |
| `walkthrough.markdown.toc` | `false` | Emit a table of contents in each guide. |
| `walkthrough.viewport` | `1280×800` | Shared viewport for both projects. |
| `walkthrough.tag` | `'@walkthrough'` | The tag that opts a test into becoming a guide. |

`defineWalkthrough` doesn't set `testMatch`; it uses Playwright's default unless you pass one.

### Wiring your own config

If you prefer to wire your own config instead of `defineWalkthrough`, register the reporter and add a project that turns on walkthrough mode for tagged tests. Project names are up to you:

```ts
import { defineConfig, devices } from '@playwright/test';
import type { WalkthroughTestOptions } from 'playwright-walkthrough';
import { tagPattern } from 'playwright-walkthrough/config';

export default defineConfig<Partial<WalkthroughTestOptions>>({
  reporter: [['list'], ['playwright-walkthrough/reporter', { title: 'My Guides' }]],
  projects: [
    { name: 'e2e', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'docs',
      grep: tagPattern('@walkthrough'), // whole-tag match: skips e.g. @walkthrough-draft
      use: { ...devices['Desktop Chrome'], walkthroughMode: true },
    },
  ],
});
```

| `use` option | Default | Description |
| --- | --- | --- |
| `walkthroughMode` | `false` | Capture guides for tagged tests. |
| `walkthroughTag` | `'@walkthrough'` | The tag that opts a test into becoming a guide. |

For an ad-hoc run, `WT=1` turns walkthrough mode on in any project: `WT=1 npx playwright test tests/projects.spec.ts`.

## How it works

- A test is captured only when walkthrough mode is on (`walkthroughMode` or `WT=1`) **and** it carries the walkthrough tag (directly or from a `test.describe`).
- **Mode off** → the `wt` calls are pass-throughs: your actions run inside named test steps, no overlay is injected, no screenshots are written.
- **Mode on** → each step injects a self-contained overlay (in a closed shadow root, isolated from your page) that highlights the target and renders narration, then a screenshot is captured. Per-test results are emitted as a `walkthrough-ir` attachment.
- The reporter aggregates the IR across workers/shards and renders `walkthrough.md` per guide plus `index.md`, then prints a summary.
- Each guide is written under a path built from its spec file (relative to `testDir`) and full title, e.g. with `testDir: 'tests'`, `tests/projects.spec.ts` › `Creating a project` → `walkthroughs/projects/creating-a-project/`. Tests with the same title in different files don't overwrite each other.

## Development

Build tooling is managed with [mise](https://mise.jdx.dev) (see `mise.toml`): [Bun](https://bun.sh) is the package manager and script runner, and Node runs Playwright's test runner, which doesn't support Bun.

```sh
mise install                      # installs bun + node
bun install
bunx playwright install chromium  # browser for the example tests

bun run typecheck
bun run build                     # compiles src/ → dist/ with tsc
bun run test                      # examples as ordinary tests
bun run walkthrough               # examples in walkthrough mode → walkthroughs/
```

## License

MIT © Graham Tibbitts
