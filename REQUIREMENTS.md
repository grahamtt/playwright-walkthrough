# Playwright Walkthrough — Requirements

> A Playwright helper library that turns ordinary functional tests into user
> walkthroughs. You annotate a test with narration and intent; running it in a
> special mode renders a **markdown guide with annotated screenshots**. The same
> annotations are designed to later render **narrated video** without changing
> test code.

**Status:** Draft v0.1 · **Date:** 2026-06-17 · **Scope of this doc:** v1 = markdown.

---

## 1. Vision

Documentation rots because it lives apart from the product. Functional tests, by
contrast, are continuously exercised against the real UI. If a test already
clicks through "create your first project," it already *is* a walkthrough — it
just lacks narration and a renderer.

This library lets you keep one artifact that is simultaneously:

- a **real functional test** (it still asserts, runs in CI, fails on regressions), and
- a **source of truth for user-facing documentation** (rendered on demand).

When the UI changes, the test breaks; you fix it; the docs regenerate. Docs and
product never drift.

---

## 2. Goals & Non-Goals

### Goals (v1)
- G1. Authoring API that layers narration onto Playwright tests **without
  breaking their behavior as tests**.
- G2. A "walkthrough mode" that, when enabled, produces a **markdown guide with
  annotated screenshots** per test.
- G3. **Zero behavioral and ~zero performance overhead** when walkthrough mode is
  off — annotated tests run as normal tests.
- G4. **Annotated screenshots**: the element a step acts on is visually
  highlighted (box/spotlight), optionally with arrows and redaction masks.
- G5. A stable, documented **Intermediate Representation (IR)** that decouples
  capture from rendering and is **forward-compatible with video**.
- G6. **Deterministic, reproducible** output suitable for committing to a docs site.
- G7. First-class **TypeScript** authoring; works with the `@playwright/test` runner.

### Non-Goals (v1)
- N1. Video rendering (deferred — but the IR must not preclude it; see §15).
- N2. Spoken narration / TTS / audio (deferred).
- N3. A hosted docs site or CMS. We emit markdown + assets; publishing is the
  user's choice (Docusaurus, MkDocs, Starlight, plain repo, etc.).
- N4. Non-Playwright test runners (Cypress, Selenium).
- N5. Recording/codegen of tests from clicks. Authors write tests as usual.
- N6. Automatic natural-language generation of narration (an auto-fallback is a
  *nice-to-have*, see §5.6 — but human-written narration is the contract).

---

## 3. Users & User Stories

**Personas**
- **The test author / engineer** — already writes Playwright tests; wants docs
  "for free" and willing to add a narration line per meaningful step.
- **The docs / DevRel writer** — owns the published guide; cares about prose,
  ordering, screenshots, branding; may not write tests but reviews the markdown.
- **The reader / end user** — consumes the published guide; never sees the library.

**Stories**
- U1. As an author, I wrap an action with a narration string and get a captioned,
  annotated screenshot in the output without writing capture code.
- U2. As an author, I mark login/seed steps as **hidden** so they run but don't
  appear in the guide.
- U3. As an author, I run my normal suite and the walkthrough annotations have no
  effect — same speed, same pass/fail.
- U4. As a docs writer, I regenerate all guides with one command and review a
  clean markdown diff after a UI change.
- U5. As a docs writer, I redact sensitive values (emails, tokens) from
  screenshots declaratively.
- U6. As a maintainer, I want a single command/flag to produce all guides in CI
  and fail loudly if a walkthrough test breaks.

---

## 4. Concepts & Terminology

- **Walkthrough** — one rendered guide produced from one test (1 test → 1 guide in v1).
- **Step** — a narrated unit of the walkthrough; may capture screenshot(s).
- **Act** — a step bound to a specific **locator** + action, so the element can be highlighted.
- **Silent block** — code that runs but is excluded from output (setup/teardown).
- **IR (Intermediate Representation)** — the JSON timeline emitted per test; the
  contract between capture and renderers.
- **Renderer** — consumes IR + assets, emits files. v1 ships the **markdown renderer**.
- **Walkthrough mode** — the execution mode that captures the IR + screenshots.

---

## 5. Authoring API

The chosen style is **action-wrapping helpers**: each narrated action passes the
narration, the locator, and the action together, so the library can highlight the
target, caption it, and capture it — all derived, no extra capture code.

The API surfaces as a fixture `wt` on the extended `test`.

```ts
import { test, expect } from 'playwright-walkthrough';

test('Create your first project', { tag: '@walkthrough' }, async ({ page, wt }) => {
  await wt.intro('Creating a project', 'A short guide to setting up your first project.');

  // Runs, but never appears in the guide:
  await wt.silently(async () => {
    await loginAs(page, 'demo@acme.test');
  });

  await wt.step('Open your dashboard', () => page.goto('/dashboard'));

  await wt.act('Click **New Project** in the top bar',
    page.getByRole('button', { name: 'New Project' }),
    (l) => l.click());

  await wt.act('Give your project a name',
    page.getByLabel('Project name'),
    (l) => l.fill('My First Project'),
    { type: 'slow' });            // pacing hint (no-op for markdown, used by future video)

  await wt.note('Your new project now appears in the sidebar.');

  // Still a genuine assertion — this is a real test:
  await expect(page.getByText('My First Project')).toBeVisible();

  await wt.outro("That's it — you've created your first project.");
});
```

### 5.1 Core methods

| Method | Purpose | Captures screenshot? |
|---|---|---|
| `wt.intro(title, description?)` | Guide front-matter: H1 title + lead paragraph. | No (optional hero shot) |
| `wt.step(narration, fn, opts?)` | A narrated step that runs `fn`. For navigation or actions with no single target. | After (default) |
| `wt.act(narration, locator, fn, opts?)` | Narrated step bound to `locator`; highlights it, then runs `fn(locator)`. | After (default), with highlight |
| `wt.note(text, opts?)` | Pure narration block (callout). | No (unless `screenshot: true`) |
| `wt.check(narration, fn, opts?)` | Visualize an assertion; `fn` runs (and may assert). | After (default) |
| `wt.section(title)` | Inserts a subsection heading; groups following steps. | No |
| `wt.screenshot(narration?, opts?)` | Explicit capture point. | Yes |
| `wt.silently(fn)` | Run `fn` with capture + narration suppressed. | No |
| `wt.outro(text)` | Closing narration block. | No |

### 5.2 Step options (`opts`)

**Per-helper screenshot defaults** (refined during M0): `act` defaults to
`'before'` — capture the highlighted target *before* the action, since the
action often destroys it (a click opens a dialog, navigates, etc.). `step`,
`check`, and `screenshot` default to `'after'` — show the resulting state.

```ts
interface StepOptions {
  screenshot?: 'before' | 'after' | 'both' | 'none'; // default per helper (see above)
  highlight?: Locator | Locator[];   // default: the act's own locator
  mask?: Locator[];                   // redact regions (Playwright mask)
  arrow?: { to: Locator; from?: 'auto' | 'top' | 'left' | ... }; // annotation
  fullPage?: boolean;                 // default false (viewport shot)
  clip?: { x; y; width; height };     // capture a sub-region
  caption?: string;                   // override the auto-caption on the image
  hidden?: boolean;                   // run but exclude from output (per-step silently)
  type?: 'slow' | 'normal' | 'instant'; // pacing hint; no-op for markdown, used by video
  waitFor?: () => Promise<void>;      // settle hook before capture (e.g. toast gone)
}
```

### 5.3 Narration format
- Narration strings are **Markdown** (inline): `**bold**`, `` `code` ``, links.
- Narration doubles as the image **alt text** for accessibility.

### 5.4 Behavior when walkthrough mode is OFF
- `wt.act/step/check` execute their callback exactly once, inside a `test.step`
  titled with the narration, and return its value. Options and capture are
  **ignored**. (The step costs next to nothing and makes the helpers useful in
  any test's report and trace, so there's no reason to write untagged tests
  differently.)
- `wt.screenshot/intro/note/outro/section` are **no-ops**.
- `wt.silently(fn)` simply runs `fn`.
- No screenshots, no IR, no extra waits → the test behaves as if `wt` weren't there.
- "Off" also applies to an untagged test in a walkthrough-mode run (§6).

### 5.5 Return values & composability
- `wt.act` resolves to the action's result and (optionally) returns the locator
  for chaining, so authors can keep using Playwright idioms and Page Objects.
- All helpers are `async` and integrate with Playwright's `test.step` tree so the
  HTML test report also shows the narrated steps.

### 5.6 No auto-narration (decided)
- Narration is **required** on every narrated helper (`act`/`step`/`check`); it
  is part of the type signature, so a step without narration is a compile error.
- The library does **not** synthesize captions from element role/name. Rationale:
  mediocre auto-text discourages writing real prose, and the narration doubles as
  image alt text where accuracy matters.

---

## 6. Execution Modes

Two ways to enable walkthrough mode; both supported:

1. **Dedicated Playwright project** (recommended). Any project with
   `use: { walkthroughMode: true }`. The `defineWalkthrough()` config helper
   registers one named `walkthrough` (plus the reporter):
   ```bash
   npx playwright test --project=walkthrough
   ```
2. **Environment flag** for ad-hoc runs:
   ```bash
   WT=1 npx playwright test path/to/file.spec.ts
   ```

**Test selection (decided).** Only tests tagged `@walkthrough` (configurable via
`walkthroughTag`; a tag on a `test.describe` counts) are walkthroughs. They live in
ordinary spec files and use the suite's normal `test`, merged with the `wt`
fixture via `mergeTests`; there is no separate file suffix, import or config.
A test is captured only when walkthrough mode is on **and** it is tagged. The
`walkthrough` project also `grep`s to tagged tests; in normal mode they run as
ordinary tests. Rationale: only a curated subset of a suite makes good guides,
but choosing that subset should be metadata on a test, not a second way of
declaring tests.

---

## 7. Intermediate Representation (IR)

Capture writes a per-test `walkthrough.json`. Renderers consume only the IR +
assets. The IR is the stable contract and is **forward-compatible with video**
(carries timing + geometry that markdown ignores).

```jsonc
{
  "schemaVersion": 1,
  "id": "create-your-first-project",
  "title": "Creating a project",
  "description": "A short guide to setting up your first project.",
  "tags": ["@walkthrough"],
  "source": { "file": "tests/projects.walkthrough.ts", "line": 12 },
  "status": "complete",            // complete | incomplete | failed
  "generatedAt": "2026-06-17T00:00:00Z",
  "environment": {
    "viewport": { "width": 1280, "height": 800 },
    "deviceScaleFactor": 2,
    "theme": "light",
    "playwrightVersion": "1.x",
    "browser": "chromium"
  },
  "steps": [
    {
      "index": 1,
      "kind": "act",              // intro|section|step|act|note|check|outro|screenshot
      "narration": "Click **New Project** in the top bar",
      "action": { "type": "click", "value": null },
      "target": {
        "selector": "getByRole('button', { name: 'New Project' })",
        "role": "button",
        "name": "New Project",
        "box": { "x": 1040, "y": 16, "width": 120, "height": 36 }
      },
      "annotations": [
        { "type": "highlight", "box": { "x": 1040, "y": 16, "width": 120, "height": 36 } }
      ],
      "screenshots": [
        { "phase": "after", "path": "assets/02-click-new-project.png",
          "width": 1280, "height": 800 }
      ],
      "timing": { "startedAt": 1234, "endedAt": 1543 }   // ms offsets; for future video
    }
  ]
}
```

Notes:
- `target.box`, `annotations[].box`, and `timing` are emitted even though the v1
  markdown renderer only needs the screenshot + narration — this is the
  forward-compat seam for video (cursor motion, spotlight, captions track).
- `schemaVersion` lets renderers and the future video pipeline evolve safely.

---

## 8. Markdown Renderer (v1)

Per walkthrough, emit `walkthrough.md`:

- **H1** from `intro.title`; lead paragraph from `intro.description`.
- Optional **table of contents** from `wt.section` headings (config flag).
- For each visible step, in order:
  - the narration as prose,
  - the screenshot via `![narration](assets/…png)` (alt = narration),
  - `note`/`outro` rendered as block callouts (`>`), `check` optionally badged.
- **Front matter** block (YAML) for static-site generators: `title`,
  `description`, `source`, `generatedAt`, plus user-supplied extras.
- A small generated footer: *"Generated from `tests/…` on <date>."*
- **Theming/templating**: ship a default template; allow a user-provided template
  (e.g. a function `(ir) => string` or a Handlebars/EJS file) to control layout,
  callout style, image wrapping, and front-matter.

Also emit a top-level **`index.md`** cataloging all walkthroughs (title,
description, link), produced by the reporter (§11).

---

## 9. Screenshot & Annotation Engine

Annotations (highlight ring, dimmed spotlight backdrop, caption bar, numbered
pins, arrows) are drawn by an **in-page overlay engine**, then captured with an
ordinary screenshot. The browser does all layout and rendering — there is **no
PNG post-processing and no native image dependency**. This same overlay engine is
reused by the future video renderer, so markdown and video share one code path.

> **Validated by spike** (`spike/`): a working engine drove identical output to
> both a screenshot and a recorded `.webm`, including highlighting an element
> *inside a modal dialog*. The findings below are baked into this section.

**One animation model for both outputs (proven).** All visual state — cursor
position, highlight rect, spotlight cutout, **and opacity** — is driven by a
single `requestAnimationFrame` tween: `animate(targetState, durationMs)`.
- **Screenshot path** = `duration 0` → snap to the end state, then capture.
- **Video path** = `duration N` → tween while Playwright's native recorder rolls;
  Node paces it by `await`ing `page.evaluate(...)`, which resolves when the
  in-page tween promise resolves.
- **Opacity must flow through the tween, never CSS `transition`.** A CSS fade
  desyncs the screenshot path (capture fires mid-fade); the spike hit exactly
  this bug. The rAF model makes the two paths provably consistent.

**Top-layer content requires Popover-API promotion (proven).** A modal
`<dialog showModal()>`, the Popover API, and fullscreen render in the browser's
**top layer**, which paints above *any* `z-index`. A plain high-z overlay is
occluded by them. The engine therefore promotes its root into the top layer via
`element.showPopover()` (`popover="manual"`) and **re-asserts** it each step
(`hidePopover()` + `showPopover()`) so it stacks above a modal opened mid-flow.
Degrades to z-index stacking if the Popover API is unavailable.

**Flow per annotated step:**
1. Resolve the target `Locator`; `scrollIntoViewIfNeeded`.
2. Inject overlay nodes via `locator.evaluate` (DOM-created, **not**
   `addScriptTag`) so strict-CSP pages don't block them. Promote root to the
   top layer (Popover API).
3. Position the highlight from the element's own `getBoundingClientRect()` — no
   device-scale-factor or scroll math. Overlay uses `position: fixed;
   pointer-events: none`.
4. `animate(...)` to the target state (duration 0 for screenshot, N for video).
5. Capture with Playwright's screenshot API at a fixed viewport &
   `deviceScaleFactor`; `mask` for redaction (Playwright draws masks in-browser
   too, so it's consistent); optional `clip`/`fullPage`.
6. Remove / fade the overlay.

**Why in-page over post-processing the PNG:** post-processing needs a *second*
renderer (sharp/canvas) to agree with the browser pixel-for-pixel — DSF math,
scroll/clip translation, and mismatched anti-aliasing/fonts are exactly where
bugs accumulate. One renderer (the browser) is simpler and more deterministic,
adds no native build dep, and is directly reusable by video.

**Caveats handled by the engine:**
- **Stale rect when the target disappears** (dialog closes, navigation) after its
  action — the spike showed a ring lingering over empty space. The highlight must
  be faded/cleared as part of the action that destroys its target, or re-queried.
- `fullPage: true` → position overlays in **document** coordinates, not `fixed`
  viewport coordinates.
- Target larger than / off the viewport → clamp the highlight; scroll first.
- Multiple highlights and arrows → all positioned from their own rects.

**Settling before capture**: wait for fonts ready, animations disabled (§10),
network idle / author-supplied `waitFor`, to avoid mid-transition shots.

**Asset naming**: `NN-slug-of-narration.png`, zero-padded, stable across runs.

---

## 10. Determinism & Reproducibility

To keep committed docs diff-friendly:

- D1. Fixed **viewport** and **deviceScaleFactor** (configurable, defaulted).
- D2. **Disable CSS animations/transitions** and honor `prefers-reduced-motion`
  via injected stylesheet, so screenshots aren't caught mid-animation.
- D3. Stable, content-derived **asset filenames** and step ordering.
- D4. Hooks to **freeze nondeterminism**: clock/date freezing, seeded data,
  locale/timezone pinning (author-provided in `silently`/fixtures).
- D5. Declarative **masking** of dynamic regions.
- D6. Document that **screenshots are not byte-identical across OS/CI**; provide a
  guidance + a `--update-screenshots`-style regeneration workflow rather than
  pretending pixel determinism. (Markdown/IR text *is* deterministic.)

---

## 11. Configuration & Integration

- Ship a **custom Playwright reporter** that:
  - aggregates per-test IR into the output tree,
  - writes `index.md`,
  - reports counts (generated / incomplete / failed) to the console,
  - exits non-zero if any walkthrough test failed (CI gate).
- Ship `defineWalkthrough(config)` to register the project + reporter and set
  defaults:
  ```ts
  // playwright.config.ts
  import { defineWalkthrough } from 'playwright-walkthrough/config';
  export default defineWalkthrough({
    outputDir: 'docs/walkthroughs',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    theme: 'light',
    annotations: { style: 'spotlight' },
    markdown: { toc: true, template: './my-template.hbs', frontMatter: { sidebar: true } },
  });
  ```

---

## 12. Output Layout

Each guide's directory (and IR `id`) is the spec file's path relative to
`testDir`, minus extension and any `.spec`/`.test`/`.walkthrough` suffix, then the
slugged describe + test title. Playwright rejects duplicate titles within a file,
so ids are unique across the suite. With `testDir: 'tests'`, for
`tests/projects.spec.ts` › "Create your first project":

```
docs/walkthroughs/
  index.md
  projects/
    create-your-first-project/
      walkthrough.md
      walkthrough.json          # IR
      assets/
        01-open-your-dashboard.png
        02-click-new-project.png
        03-give-your-project-a-name.png
```

---

## 13. Failure Handling

- If a walkthrough test **fails mid-run**, emit IR with `status: "failed"` (or
  `"incomplete"`) containing the steps captured so far, and surface a clear
  console message + non-zero exit via the reporter.
- A failed step records the error so the partial guide makes the breakage obvious
  rather than silently producing a truncated doc.
- Capture/annotation errors must **never change test pass/fail** — they degrade to
  warnings (a step without a screenshot still renders its narration).

---

## 14. Non-Functional Requirements

- NF1. **TypeScript-first**, shipped with types; ESM + CJS.
- NF2. **Zero overhead off** (§5.4): no extra awaits, no captures, no IO.
- NF3. **Minimal dependencies**: `@playwright/test` as a peer dep. **No native
  image dependency** — annotations are rendered in-browser (§9). No heavyweight
  runtime.
- NF4. **Node 18+**, Chromium primary target (others best-effort).
- NF5. **CI-friendly**: headless, single command, deterministic text output.
- NF6. **Documented public API** with examples; semver on the IR `schemaVersion`.
- NF7. Works with **Page Object Models** and existing fixtures (helpers take plain
  `Locator`s).

---

## 15. Extensibility & Future Work

- **Video renderer (next milestone).** Consumes the same IR and **reuses the §9
  overlay engine** (synthetic cursor, element spotlight, click ripples, caption
  bar), now injected continuously during a walkthrough run so Playwright's native
  recording captures smooth motion; `timing` + `type` hints drive pacing/dwell.
  The IR already carries geometry + timing for this — **no test-code changes
  required**.
- **Audio / TTS.** Pluggable provider interface to synthesize a voiceover from
  narration and mux with `ffmpeg`. Captions remain the always-on baseline.
- **Additional renderers.** HTML/interactive, PDF, in-app product tours (e.g.
  emit a driver.js/Shepherd tour spec from the IR).
- **Renderer plugin interface.** `Renderer { name; render(ir, assets, ctx): Files }`
  so third parties can add outputs without touching capture.
- **Multi-test guides ("courses").** Compose several walkthroughs into one
  ordered document. (v1 is 1 test → 1 guide.)
- **Localization.** Narration keyed by locale; render one guide per language.

---

### Decided
- **Annotation rendering** → in-page overlay engine; no PNG post-processing (§9).
- **Auto-narration** → not included; narration is required (§5.6).
- **Image dependency** → none; annotations rendered in-browser (§9, NF3).
- **Visual assertions** → `wt.check` is kept in v1 (§5.1).
- **`wt.check` rendering** → neutral prose, captures `after` (no pass/fail badge);
  it renders identically to a numbered step in the guide (M1).
- **ToC** → opt-in via `defineWalkthrough({ markdown: { toc: true } })` (M1).

## 16. Open Questions

1. **Screenshot review in CI**: built-in "approve/regenerate" flow, or leave it to
   the host repo's image-diff tooling?
2. **Naming/packaging**: single package vs. `core` + `markdown` + `config` subpath
   exports. (Leaning: one package, subpath exports.)
3. **Front matter contract**: which fields are guaranteed for Docusaurus/MkDocs/
   Starlight out of the box?
4. **Locator robustness guidance**: the Trac POC showed accessible-text locators
   go ambiguous once lists/grids load (e.g. `getByText('Asset')` matched 8 cards);
   prefer stable `data-testid`s. Codify this as authoring guidance / a lint?

---

## 17. Milestones

- **M0 — API + capture (DONE)**: `test` extension + `wt` fixture; full helper set
  (`intro/step/act/check/note/section/screenshot/outro/silently`); no-op path
  proven (off = zero artifacts); in-page overlay engine integrated (incl. modal
  top-layer); per-test IR + annotated screenshots written to disk. See
  `src/`, `examples/projects.walkthrough.ts`.
- **M1 — Markdown MVP (DONE)**: markdown renderer over the IR (`src/markdown.ts`);
  custom reporter that auto-renders `walkthrough.md` per guide + a top-level
  `index.md` on every run, aggregating across workers via a `walkthrough-ir`
  attachment (`src/reporter.ts`); `defineWalkthrough()` config helper wiring the
  projects + reporter + output dir (`src/config.ts`). `opts.waitFor` settle hook
  added. Verified on the live Trac app (`examples/trac-holding.walkthrough.ts`).
- **M1.5 — One way to declare tests (DONE)**: opt in by tag, not file suffix
  (§6); `walkthroughMode`/`walkthroughTag` option fixtures replace the
  project-name check; `defineWalkthrough` no longer overrides `testMatch`;
  narrated helpers report as `test.step` in both modes (§5.4, §5.5); guide ids
  include the spec path (§12). Page-object example in `examples/`.
- **M2 — Polish**: masking, arrows, sections/ToC content, templating/theming,
  determinism hooks, richer failure handling, docs + examples.
- **M3 — Video (separate doc)**: overlay engine + video renderer over the same IR.
```
