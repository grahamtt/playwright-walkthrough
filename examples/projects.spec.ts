import { test, expect } from './fixtures';

// Becomes a guide: tagged, so the `walkthrough` project captures it.
test('Create your first project', { tag: '@walkthrough' }, async ({ projects, wt }) => {
  await wt.intro('Creating a project', 'A short guide to setting up your first project.');

  await projects.open();
  await projects.create('Website redesign');

  await wt.note('Your new project now appears in your list.');

  // Still a genuine assertion — this remains a real functional test.
  await expect(projects.card('Website redesign')).toBeVisible();

  await wt.outro("That's it — you've created your first project.");
});

// An ordinary functional test, written the same way. Untagged, so it never
// produces a guide; the page object's narration shows up only as test steps.
test('Cancelling the dialog does not create a project', async ({ projects }) => {
  await projects.open();
  await projects.startNewProject('Scratch');
  await projects.cancel();

  await expect(projects.card('Scratch')).toHaveCount(0);
  await expect(projects.emptyState).toBeVisible();
});
