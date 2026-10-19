import type { Locator, Page } from '@playwright/test';
import type { Walkthrough } from '../../src';

/**
 * A page object whose methods carry their own narration. Every test that uses
 * it reads the same; the narration only becomes a guide when the test is
 * tagged `@walkthrough` and walkthrough mode is on. Otherwise each `wt.*` call
 * is just a named `test.step`.
 */
export class ProjectsPage {
  constructor(
    private readonly page: Page,
    private readonly wt: Walkthrough,
    private readonly url: string,
  ) {}

  async open(): Promise<void> {
    await this.wt.step('Open your dashboard', () => this.page.goto(this.url));
  }

  /** Open the New Project dialog and type a name, without confirming. */
  async startNewProject(name: string): Promise<void> {
    await this.wt.act('Click **New Project** in the top bar',
      this.page.getByRole('button', { name: 'New Project' }),
      (l) => l.click());

    await this.wt.act('Give your project a **name**',
      this.page.getByLabel('Project name'),
      (l) => l.fill(name));
  }

  async confirm(): Promise<void> {
    await this.wt.act('Hit **Create project** to finish',
      this.page.getByRole('button', { name: 'Create project' }),
      (l) => l.click());
  }

  async cancel(): Promise<void> {
    await this.wt.act('Changed your mind? Click **Cancel** to close the dialog',
      this.page.getByRole('button', { name: 'Cancel' }),
      (l) => l.click());
  }

  async create(name: string): Promise<void> {
    await this.startNewProject(name);
    await this.confirm();
  }

  card(name: string): Locator {
    return this.page.locator('.card', { hasText: name });
  }

  get emptyState(): Locator {
    return this.page.getByText('No projects yet');
  }
}
