// Renders extension/icons/icon{16,32,48,128}.png from the SVG below.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sizes = [16, 32, 48, 128];

// A face split down the middle by a mirror line: one half solid, the other its reflection.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c6ef5"/>
      <stop offset="1" stop-color="#3b3fc4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <path d="M60 24a40 40 0 0 0 0 80z" fill="#fff"/>
  <path d="M68 24a40 40 0 0 1 0 80z" fill="#fff" opacity=".45"/>
  <circle cx="44" cy="56" r="6" fill="#3b4fd8"/>
  <circle cx="84" cy="56" r="6" fill="#3b4fd8" opacity=".8"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.locator('svg').screenshot({
    path: path.join(root, 'extension', 'icons', `icon${size}.png`),
    omitBackground: true,
  });
}
await browser.close();
console.log('icons written:', sizes.join(', '));
