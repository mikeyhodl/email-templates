/**
 * Render every compiled template to a thumbnail for the README gallery.
 *
 *   npm run screenshots
 *
 * Uses the locally installed Google Chrome (playwright-core ships no browser),
 * renders each email at its native 600px width and writes a top-of-email crop
 * to screenshots/NN.jpg — sized for the README gallery, not for print.
 */
import { chromium } from 'playwright-core';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'screenshots');

const WIDTH = 600;   // email body width
const HEIGHT = 800;  // how much of the top of the email the thumbnail shows
const QUALITY = 88;  // JPEG quality — these render at ~250px in the README

const ids = readdirSync(repoRoot)
  .filter((f) => /^\d+$/.test(f) && existsSync(join(repoRoot, f, 'index.html')))
  .sort((a, b) => a - b);

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
});

console.log(`Capturing ${ids.length} templates...`);
for (const id of ids) {
  await page.goto(pathToFileURL(join(repoRoot, id, 'index.html')).href, {
    waitUntil: 'networkidle',
  });
  // Web fonts load from Google Fonts; give them a beat to swap in.
  await page.evaluate(() => document.fonts.ready);
  const name = `${String(id).padStart(2, '0')}.jpg`;
  await page.screenshot({
    path: join(outDir, name),
    type: 'jpeg',
    quality: QUALITY,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  console.log(`  ${id}/index.html -> screenshots/${name}`);
}

await browser.close();
console.log('Done.');
