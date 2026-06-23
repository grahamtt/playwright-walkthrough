import { test, expect } from '../src';

const APP = 'https://app.test.trac.bot/';
const USER = 'tester-functional';
const PASS = 'Password123!';

test('Create a holding', { tag: '@walkthrough' }, async ({ page, wt }) => {
  test.setTimeout(120_000); // real app over the network; be generous

  await wt.intro(
    'Create a holding',
    'How to add a new holding to your portfolio in Trac.',
  );

  // Logging in is setup, not part of the guide — run it silently.
  await wt.silently(async () => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Username' }).fill(USER);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASS);
    await page.getByText('Login', { exact: true }).click();
    await page.getByText('Add Item', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    // The Search landing loads recent results on its own — wait for that so the
    // backdrop behind every step is the populated list, not a loading spinner.
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 25_000 });
  });

  await wt.act('Click **Add Item** in the sidebar to start adding something new.',
    page.getByText('Add Item', { exact: true }),
    (l) => l.click());

  await wt.act('Choose **Holding** from the list of things you can add.',
    page.getByText('Holding', { exact: true }),
    (l) => l.click());

  await wt.act('Give your holding a **name**.',
    page.getByPlaceholder('Start typing…').first(),
    (l) => l.fill('POC Test Holding'));

  await wt.act('Open the **Type** dropdown.',
    page.getByText('Choose', { exact: true }),
    (l) => l.click());

  await wt.act('Pick a type for the holding — here we’ll use **Asset**.',
    page.getByTestId('dropdown:type:asset'), // scoped to the dropdown; "Asset" also appears on result cards
    (l) => l.click());

  await wt.act('Click **Save** to create the holding.',
    page.getByRole('button', { name: 'Save' }),
    (l) => l.click());

  // Real assertion: Trac confirms the save and opens the new item's detail page.
  await wt.check('Your new holding now has its own detail page.', async () => {
    await expect(page.getByText('Save successful')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/portfolio-item-detail/);
  }, {
    // Let the detail page finish loading (the Stats table) before the screenshot,
    // so we capture the holding rather than a loading spinner.
    waitFor: async () => {
      await page.getByText('Cost Basis').waitFor({ state: 'visible', timeout: 15_000 });
    },
  });

  await wt.outro('That’s it — your new holding has been created and saved.');
});
