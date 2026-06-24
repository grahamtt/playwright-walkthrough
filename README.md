# playwright-walkthrough

Turn your Playwright functional tests into user-facing walkthroughs — **markdown guides with annotated screenshots** — without maintaining a second suite of "documentation tests."

A walkthrough test is a real Playwright test: it still navigates, acts, and asserts. When run in walkthrough mode it *also* injects an in-page overlay that highlights each target and renders narration, captures a screenshot per step, and a reporter stitches everything into `walkthrough.md` files plus a top-level `index.md`. When run as an ordinary test (mode off) it produces **zero artifacts and zero overhead** — the same file doubles as your e2e test.

## Install

```sh
npm install --save-dev playwright-walkthrough @playwright/test
```

`@playwright/test` is a peer dependency (>= 1.49). Requires Node >= 18.

## Quick start

**1. Wire up your Playwright config** with `defineWalkthrough`, which registers the reporter and defines two projects — `chromium` (mode off, ordinary tests) and `walkthrough` (mode on, captures artifacts):

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

**2. Write a walkthrough test.** Import `test`/`expect` from `playwright-walkthrough` instead of `@playwright/test` — it adds a `wt` fixture for narration and capture:

```ts
// guides/first-project.walkthrough.ts
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

Test files are matched by `**/*.walkthrough.ts` by default.

**3. Generate the guides:**

```sh
npx playwright test --project=walkthrough
# 📖 Walkthroughs: 1 generated → walkthroughs/index.md
```

Run the same files as plain tests (no artifacts) with `--project=chromium`.

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

## Configuration

`defineWalkthrough(config)` accepts any standard Playwright config field (which override the defaults) plus a `walkthrough` block:

| Option | Default | Description |
| --- | --- | --- |
| `walkthrough.outputDir` | `'walkthroughs'` | Output root for guides + `index.md` (relative to cwd). |
| `walkthrough.title` | `'Walkthroughs'` | Title for the generated `index.md`. |
| `walkthrough.markdown.toc` | `false` | Emit a table of contents in each guide. |
| `walkthrough.viewport` | `1280×800` | Shared viewport for both projects. |

### Using the reporter directly

If you prefer to wire your own config instead of `defineWalkthrough`, register the reporter yourself:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['playwright-walkthrough/reporter', { title: 'My Guides' }]],
});
```

## How it works

- **Mode off** → the `wt` calls are pass-throughs: your actions run, no overlay is injected, no screenshots are written.
- **Mode on** → each step injects a self-contained overlay (in a closed shadow root, isolated from your page) that highlights the target and renders narration, then a screenshot is captured. Per-test results are emitted as a `walkthrough-ir` attachment.
- The reporter aggregates the IR across workers/shards and renders `walkthrough.md` per guide plus `index.md`, then prints a summary.

## License

MIT © Graham Tibbitts
