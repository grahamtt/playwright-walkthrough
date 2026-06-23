import { test, expect } from '../src';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const APP = pathToFileURL(join(__dirname, 'app', 'index.html')).href;

test('Create your first project', { tag: '@walkthrough' }, async ({ page, wt }) => {
  await wt.intro('Creating a project', 'A short guide to setting up your first project.');

  await wt.step('Open your dashboard', () => page.goto(APP));

  await wt.act('Click **New Project** in the top bar',
    page.getByRole('button', { name: 'New Project' }),
    (l) => l.click());

  await wt.act('Give your project a **name**',
    page.getByLabel('Project name'),
    (l) => l.fill('Website redesign'));

  await wt.act('Hit **Create project** to finish',
    page.getByRole('button', { name: 'Create project' }),
    (l) => l.click());

  await wt.note('Your new project now appears in your list.');

  // Still a genuine assertion — this remains a real functional test.
  await expect(page.getByText('Website redesign')).toBeVisible();

  await wt.outro("That's it — you've created your first project.");
});
