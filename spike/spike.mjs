/**
 * Overlay engine spike.
 *
 * Proves the central claim: ONE overlay engine + ONE animation model drives
 * both outputs.
 *   - SCREENSHOT path: snap the overlay to its end state (duration 0), capture.
 *   - VIDEO path: run the SAME calls with real durations; Playwright's native
 *     recorder captures the tweened frames. Node paces it by awaiting the
 *     evaluate() calls, which resolve when the in-page tween promises resolve.
 *
 * Run: npm run spike
 */
import { chromium } from 'playwright';
import { installOverlay } from './overlay.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const APP_URL = pathToFileURL(join(here, 'sample-app.html')).href;
const OUT = join(here, 'out');
const VIEWPORT = { width: 1280, height: 800 };
const DSF = 2;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The narrated sequence — the kind of thing the real library would derive from
// wt.act(...) calls. Each step targets a selector and carries a caption.
const SCRIPT = [
  { selector: '#new-project', label: 'Click <b>New Project</b> to get started.', then: 'open-dialog' },
  { selector: '#project-name', label: 'Give your project a <b>name</b>.', then: 'type' },
  { selector: '#create', label: 'Hit <b>Create project</b> to finish.', then: 'create' },
];

async function newPage(context) {
  const page = await context.newPage();
  await page.goto(APP_URL);
  // Inject the engine via evaluate (CDP path — CSP-safe), after load.
  await page.evaluate(installOverlay);
  return page;
}

// Perform the app-level side effect a step implies (the "real test action").
async function performAction(page, then) {
  if (then === 'open-dialog') await page.click('#new-project');
  else if (then === 'type') await page.fill('#project-name', 'Website redesign');
  else if (then === 'create') await page.click('#create');
}

// ---------------------------------------------------------------------------
// 1) SCREENSHOT path: duration 0, capture after each step settles.
// ---------------------------------------------------------------------------
async function captureScreenshots(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF });
  const page = await newPage(context);
  let i = 0;
  for (const step of SCRIPT) {
    // If a prior step opened the dialog, the target now exists.
    await page.waitForSelector(step.selector, { state: 'visible' });
    await page.evaluate(
      ([sel, label]) => window.__wt.focusSelector(sel, { label, duration: 0 }),
      [step.selector, step.label],
    );
    const n = String(++i).padStart(2, '0');
    await page.screenshot({ path: join(OUT, `screenshot-${n}.png`) });
    await performAction(page, step.then);
  }
  await context.close();
  console.log(`✓ screenshots: ${i} captured`);
}

// ---------------------------------------------------------------------------
// 2) VIDEO path: same engine, real durations, native recorder captures frames.
// ---------------------------------------------------------------------------
async function captureVideo(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DSF,
    recordVideo: { dir: OUT, size: VIEWPORT },
  });
  const page = await newPage(context);

  await page.evaluate(() => window.__wt.say('Let’s create your first project.', { duration: 400 }));
  await page.waitForTimeout(900);

  for (const step of SCRIPT) {
    await page.waitForSelector(step.selector, { state: 'visible' });
    // animate cursor + spotlight to the target over 700ms (await => Node paces)
    await page.evaluate(
      ([sel, label]) => window.__wt.focusSelector(sel, { label, duration: 700 }),
      [step.selector, step.label],
    );
    await page.waitForTimeout(450);          // dwell so it's readable on video
    await page.evaluate(() => window.__wt.click());
    await performAction(page, step.then);
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => window.__wt.clear({ duration: 400 }));
  await page.waitForTimeout(600);

  const video = page.video();
  await context.close(); // finalizes the .webm
  const src = await video.path();
  const dest = join(OUT, 'walkthrough.webm');
  renameSync(src, dest);
  console.log(`✓ video: ${dest} (${(statSync(dest).size / 1024).toFixed(0)} KB)`);
}

const browser = await chromium.launch();
try {
  await captureScreenshots(browser);
  await captureVideo(browser);
} finally {
  await browser.close();
}

console.log('\nArtifacts in', OUT + ':');
for (const f of readdirSync(OUT).sort()) {
  console.log('  ', f, `(${(statSync(join(OUT, f)).size / 1024).toFixed(0)} KB)`);
}
