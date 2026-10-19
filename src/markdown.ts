import type { WalkthroughIR } from './types';

export interface MarkdownOptions {
  /** Emit a "Contents" list from section headings. */
  toc?: boolean;
}

export interface IndexOptions {
  title?: string;
}

/** Strip inline Markdown so a string is safe as alt text / a heading anchor. */
export function stripMd(s: string): string {
  return s.replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function anchor(s: string): string {
  return stripMd(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Render one walkthrough IR to a Markdown guide. */
export function renderGuide(ir: WalkthroughIR, opts: MarkdownOptions = {}): string {
  const L: string[] = [];

  // YAML front matter for static-site generators.
  L.push('---');
  L.push(`title: ${JSON.stringify(ir.title)}`);
  L.push(`description: ${JSON.stringify(ir.description)}`);
  L.push(`source: ${ir.source.file}`);
  L.push(`generated: ${ir.generatedAt}`);
  L.push('---', '');

  L.push(`# ${ir.title}`, '');
  if (ir.description) L.push(ir.description, '');

  if (opts.toc) {
    const sections = ir.steps.filter((s) => s.kind === 'section');
    if (sections.length) {
      L.push('## Contents', '');
      for (const s of sections) L.push(`- [${stripMd(s.narration)}](#${anchor(s.narration)})`);
      L.push('');
    }
  }

  let n = 0;
  for (const step of ir.steps) {
    switch (step.kind) {
      case 'intro':
        break; // already reflected in the title + description
      case 'section':
        L.push(`## ${stripMd(step.narration)}`, '');
        break;
      case 'note':
        L.push(`> ${step.narration}`, '');
        break;
      case 'outro':
        L.push('---', '', step.narration, '');
        break;
      default: {
        // act | step | check | screenshot → a numbered step (+ screenshot)
        n += 1;
        L.push(`### ${n}. ${step.narration}`, '');
        for (const shot of step.screenshots ?? []) {
          L.push(`![${stripMd(step.narration)}](${shot.path})`, '');
        }
      }
    }
  }

  L.push('', `<sub>Generated from \`${ir.source.file}\` — status: ${ir.status}.</sub>`, '');
  return L.join('\n');
}

/** Render the catalog of all guides. Each guide links to `<id>/walkthrough.md`. */
export function renderIndex(guides: Array<{ ir: WalkthroughIR }>, opts: IndexOptions = {}): string {
  const L: string[] = [`# ${opts.title ?? 'Walkthroughs'}`, ''];
  for (const { ir } of guides) {
    const status = ir.status === 'complete' ? '' : `  _(${ir.status})_`;
    L.push(`- [${ir.title}](${ir.id}/walkthrough.md) — ${ir.description}${status}`);
  }
  return L.join('\n') + '\n';
}
