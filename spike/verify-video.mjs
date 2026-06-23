/**
 * Verify the recorded video actually contains the overlay, by loading the .webm
 * into a <video>, seeking to a few timestamps, and screenshotting each.
 * (No ffmpeg in this env, so the browser is our decoder.)
 *
 * Run: node verify-video.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');

// An HTML file in the same folder as the .webm => same file:// origin => allowed.
const player = join(out, '_player.html');
writeFileSync(player, `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#000">
<video id="v" src="walkthrough.webm" muted preload="auto"
       style="width:1280px;height:800px"></video>`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(pathToFileURL(player).href);

await page.waitForFunction(() => document.getElementById('v').readyState >= 2, null, { timeout: 15000 });

// Playwright .webm reports Infinity duration until you seek past the end once.
const dur = await page.evaluate(() => new Promise((res) => {
  const v = document.getElementById('v');
  if (isFinite(v.duration) && v.duration > 0) return res(v.duration);
  v.addEventListener('seeked', function once() {
    v.removeEventListener('seeked', once);
    res(v.duration);
  });
  v.currentTime = 1e6;
}));
console.log('video duration:', Number(dur).toFixed(2), 's');

for (const [name, frac] of [['early', 0.25], ['mid', 0.55], ['late', 0.82]]) {
  await page.evaluate((t) => new Promise((res) => {
    const v = document.getElementById('v');
    v.addEventListener('seeked', function once() { v.removeEventListener('seeked', once); res(); });
    v.currentTime = t;
  }), dur * frac);
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(out, `videoframe-${name}.png`) });
  console.log('captured frame:', name, `(t=${(dur * frac).toFixed(2)}s)`);
}
await browser.close();
