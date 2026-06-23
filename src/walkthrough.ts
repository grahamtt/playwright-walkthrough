import type { Locator, Page, TestInfo } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { installOverlay } from './overlay';
import type { IRScreenshot, IRStep, Rect, StepKind, StepOptions, WalkthroughIR } from './types';

/**
 * The `wt` fixture object. Every authoring helper has two paths:
 *   - mode OFF  → run the user's callback and return; record nothing, touch no
 *                 disk, inject no overlay. This is the zero-overhead contract:
 *                 an annotated test behaves exactly like a plain test.
 *   - mode ON   → drive the overlay engine, capture screenshot(s), append to the
 *                 in-memory IR, which is flushed to disk at teardown.
 */
export class Walkthrough {
  /** True when walkthrough mode is active for this test. */
  readonly enabled: boolean;

  private steps: IRStep[] = [];
  private title: string;
  private description = '';
  private stepIndex = 0;
  private shotCount = 0;
  private dir = '';
  private assetsDir = '';

  constructor(private readonly page: Page, private readonly info: TestInfo) {
    this.enabled = info.project.name === 'walkthrough' || process.env.WT === '1';
    this.title = info.title;
  }

  /** Fixture setup: prepare the output dir and arm overlay injection. */
  async begin(): Promise<void> {
    if (!this.enabled) return;
    const root = process.env.WT_OUT || join(process.cwd(), 'walkthroughs');
    this.dir = join(root, slug(this.info.title));
    this.assetsDir = join(this.dir, 'assets');
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.assetsDir, { recursive: true });
    // Re-injects on every navigation; self-guards against double-install.
    await this.page.addInitScript(installOverlay);
  }

  // ---- authoring API -------------------------------------------------------

  /** Guide front matter: title + lead paragraph. */
  async intro(title: string, description = ''): Promise<void> {
    if (!this.enabled) return;
    this.title = title;
    this.description = description;
    this.record('intro', title);
  }

  /** A narrated step with no single target (navigation, multi-element actions). */
  async step<T>(narration: string, fn: () => Promise<T> | T, opts: StepOptions = {}): Promise<T> {
    if (!this.enabled) return fn();
    const result = await fn();
    await this.shoot('step', narration, undefined, opts.screenshot ?? 'after', opts);
    return result;
  }

  /** A narrated step bound to a locator: highlight it, then run the action. */
  async act<T>(
    narration: string,
    locator: Locator,
    fn: (l: Locator) => Promise<T> | T,
    opts: StepOptions = {},
  ): Promise<T> {
    if (!this.enabled) return fn(locator);

    const phase = opts.screenshot ?? 'before';
    const wantBefore = phase === 'before' || phase === 'both';
    const wantAfter = phase === 'after' || phase === 'both';

    if (wantBefore) await this.settle(opts);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const box = await this.stableBox(locator); // wait out entrance animations
    await this.highlight(box, narration);

    const shots: IRScreenshot[] = [];
    if (wantBefore) shots.push(await this.capture(narration, 'before', !!opts.fullPage));
    const result = await fn(locator);
    if (wantAfter) {
      await this.settle(opts);
      shots.push(await this.capture(narration, 'after', !!opts.fullPage));
    }

    this.record('act', narration, { selector: safeSelector(locator), box: box ?? null }, shots);
    return result;
  }

  /** Visualize an assertion: run it, then capture the asserted state. */
  async check<T>(narration: string, fn: () => Promise<T> | T, opts: StepOptions = {}): Promise<T> {
    if (!this.enabled) return fn();
    const result = await fn();
    await this.shoot('check', narration, undefined, opts.screenshot ?? 'after', opts);
    return result;
  }

  /** Pure narration block. Captures a screenshot only if asked. */
  async note(text: string, opts: StepOptions = {}): Promise<void> {
    if (!this.enabled) return;
    if (opts.screenshot && opts.screenshot !== 'none') {
      await this.shoot('note', text, undefined, 'after', opts);
    } else {
      this.record('note', text);
    }
  }

  /** A subsection heading that groups following steps. */
  section(title: string): void {
    if (!this.enabled) return;
    this.record('section', title);
  }

  /** Explicit capture point. */
  async screenshot(narration = '', opts: StepOptions = {}): Promise<void> {
    if (!this.enabled) return;
    await this.shoot('screenshot', narration, undefined, 'after', opts);
  }

  /** Closing narration. */
  async outro(text: string): Promise<void> {
    if (!this.enabled) return;
    this.record('outro', text);
  }

  /** Run setup/teardown that should NOT appear in the guide (login, seeding). */
  async silently<T>(fn: () => Promise<T> | T): Promise<T> {
    return fn(); // never recorded, identical in both modes
  }

  /** Fixture teardown: flush the IR to disk (mode ON only). */
  async end(): Promise<void> {
    if (!this.enabled) return;
    const passed = this.info.status === 'passed';
    const ir: WalkthroughIR = {
      schemaVersion: 1,
      id: slug(this.info.title),
      title: this.title,
      description: this.description,
      tags: this.info.tags ?? [],
      source: { file: relative(process.cwd(), this.info.file), line: this.info.line },
      status: passed ? 'complete' : this.steps.length ? 'incomplete' : 'failed',
      generatedAt: new Date().toISOString(),
      environment: {
        viewport: this.page.viewportSize(),
        browser: this.page.context().browser()?.browserType().name() ?? this.info.project.name,
      },
      steps: this.steps,
    };
    const irPath = join(this.dir, 'walkthrough.json');
    writeFileSync(irPath, JSON.stringify(ir, null, 2));
    // Hand the IR to the reporter via an attachment, so it renders only the
    // guides produced *this run* (no stale re-rendering of old output).
    this.info.attachments.push({ name: 'walkthrough-ir', path: irPath, contentType: 'application/json' });
  }

  // ---- internals -----------------------------------------------------------

  /** Run the user's settle hook before a capture; never fail the test on it. */
  private async settle(opts: StepOptions): Promise<void> {
    if (opts.waitFor) await opts.waitFor().catch(() => {});
  }

  /** Poll boundingBox until it stops moving, so we highlight/capture the
   *  settled position rather than a mid-animation frame (max ~1s). */
  private async stableBox(locator: Locator): Promise<Rect | null> {
    let prev: Rect | null = null;
    for (let i = 0; i < 20; i++) {
      const b = await locator.boundingBox();
      if (
        b && prev &&
        Math.abs(b.x - prev.x) < 0.5 && Math.abs(b.y - prev.y) < 0.5 &&
        Math.abs(b.width - prev.width) < 0.5 && Math.abs(b.height - prev.height) < 0.5
      ) {
        return b;
      }
      prev = b;
      await this.page.waitForTimeout(50);
    }
    return prev;
  }

  private async highlight(box: Rect | null, label: string): Promise<void> {
    await this.page.evaluate(installOverlay).catch(() => {}); // safety net for the current doc
    if (!box) return;
    await this.page.evaluate(
      ([b, l]: [Rect, string]) =>
        (window as unknown as { __wt: { focus(r: object, o: object): Promise<void> } }).__wt.focus(
          { x: b.x, y: b.y, w: b.width, h: b.height },
          { label: l, duration: 0 },
        ),
      [box, inlineMd(label)] as [Rect, string], // caption takes HTML; narration is Markdown
    );
  }

  private async shoot(
    kind: StepKind,
    narration: string,
    target: IRStep['target'] | undefined,
    phase: 'before' | 'after',
    opts: StepOptions,
  ): Promise<void> {
    await this.settle(opts);
    await this.page.evaluate(installOverlay).catch(() => {});
    // No target to highlight: clear any prior highlight (so we don't inherit a
    // stale ring) and show this step's narration as a plain caption.
    await this.page
      .evaluate(
        (html: string) =>
          (window as unknown as { __wt: { say(t: string, o: object): Promise<void> } }).__wt.say(html, {
            duration: 0,
          }),
        inlineMd(narration),
      )
      .catch(() => {});
    const shot = await this.capture(narration, phase, !!opts.fullPage);
    this.record(kind, narration, target, [shot]);
  }

  private async capture(narration: string, phase: 'before' | 'after', fullPage: boolean): Promise<IRScreenshot> {
    const n = String(++this.shotCount).padStart(2, '0');
    const name = `${n}-${slug(narration) || 'step'}.png`;
    await this.page.screenshot({ path: join(this.assetsDir, name), fullPage });
    return { phase, path: join('assets', name) };
  }

  private record(kind: StepKind, narration: string, target?: IRStep['target'], screenshots: IRScreenshot[] = []): void {
    this.steps.push({ index: ++this.stepIndex, kind, narration, target, screenshots });
  }
}

/** Slugify narration/title into a filesystem- and URL-safe string. */
function slug(s: string): string {
  return s
    .replace(/[*_`[\]()]/g, '') // strip common markdown
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Best-effort human-readable selector for the IR (debugging/traceability). */
function safeSelector(locator: Locator): string {
  return String(locator);
}

/** Convert inline Markdown (bold/italic/code) to safe HTML for the caption. */
function inlineMd(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}
