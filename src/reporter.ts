import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { renderGuide, renderIndex } from './markdown';
import type { WalkthroughIR } from './types';

export interface ReporterOptions {
  /** Where index.md is written. Defaults to the output root the guides were written under. */
  outputDir?: string;
  /** Title for index.md. */
  title?: string;
  /** Emit a table of contents in each guide. */
  toc?: boolean;
}

/**
 * Aggregates the per-test IR (delivered via the `walkthrough-ir` attachment) and
 * renders one `walkthrough.md` per guide plus a top-level `index.md`. Runs in the
 * main process, so it works across workers and sharding. No-ops when no
 * walkthroughs were produced (e.g. a normal, mode-off run).
 */
export default class WalkthroughReporter implements Reporter {
  private guides = new Map<string, { ir: WalkthroughIR; dir: string }>();

  constructor(private readonly options: ReporterOptions = {}) {}

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const att of result.attachments) {
      if (att.name !== 'walkthrough-ir' || !att.path) continue;
      try {
        const ir = JSON.parse(readFileSync(att.path, 'utf8')) as WalkthroughIR;
        this.guides.set(ir.id, { ir, dir: dirname(att.path) }); // last result wins (retries)
      } catch {
        /* ignore unreadable IR */
      }
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
    if (this.guides.size === 0) return;

    const guides = [...this.guides.values()].sort((a, b) => a.ir.title.localeCompare(b.ir.title));
    let complete = 0;
    let problems = 0;
    for (const g of guides) {
      writeFileSync(join(g.dir, 'walkthrough.md'), renderGuide(g.ir, { toc: this.options.toc }));
      if (g.ir.status === 'complete') complete += 1;
      else problems += 1;
    }

    // A guide's id is its path under the output root, so walk back up that many levels.
    const first = guides[0];
    const outputDir = this.options.outputDir ?? resolve(first.dir, ...first.ir.id.split('/').map(() => '..'));
    writeFileSync(join(outputDir, 'index.md'), renderIndex(guides, { title: this.options.title }));

    const rel = relative(process.cwd(), outputDir) || '.';
    const tail = problems ? `  (${complete} complete, ${problems} incomplete/failed)` : '';
    // eslint-disable-next-line no-console
    console.log(`\n📖 Walkthroughs: ${guides.length} generated → ${join(rel, 'index.md')}${tail}`);
  }
}
