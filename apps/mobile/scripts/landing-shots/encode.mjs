// Landing-page screenshots (D-226), step 3 of 3: writes the web page's images.
//
// - App screens: the PNGs from capture.mjs (1170 × 2532, device scale 3) → apps/web/public/landing/app/<name>.webp,
//   780 px wide (2× the 390 CSS px they are shown at), whole, never cropped.
// - Photos: the Pexels originals listed in apps/web/public/landing/photos/CREDITS.md → <name>-1600.webp and
//   <name>-800.webp (longest side). Replace these with the owner's own photos when there are some; keep the names.
//
//   node apps/mobile/scripts/landing-shots/encode.mjs <capture-dir>      (from the repo root)
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const raw = process.argv[2];
if (!raw) throw new Error('usage: encode.mjs <capture-dir>');
const root = resolve(import.meta.dirname, '../../../..');
const appDir = join(root, 'apps/web/public/landing/app');
const photoDir = join(root, 'apps/web/public/landing/photos');
mkdirSync(appDir, { recursive: true });
mkdirSync(photoDir, { recursive: true });

for (const file of readdirSync(raw).filter((f) => f.endsWith('.png') && !f.includes('failed'))) {
  const name = file.replace(/\.png$/, '');
  const info = await sharp(join(raw, file))
    .resize({ width: 780 })
    .webp({ quality: 82, smartSubsample: true })
    .toFile(join(appDir, `${name}.webp`));
  console.log(`app/${name}.webp`, info.width, info.height, info.size);
}

/** Page photo name → Pexels id (CREDITS.md has the photographer and page for each). */
const PHOTOS = {
  'board-games': 8111356,
  run: 5038843,
  chai: 18516399,
  'open-mic': 7754791,
  trek: 6125822,
  charminar: 5615112,
};
for (const [name, id] of Object.entries(PHOTOS)) {
  const res = await fetch(`https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const image = Buffer.from(await res.arrayBuffer());
  for (const width of [1600, 800]) {
    const info = await sharp(image)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(join(photoDir, `${name}-${width}.webp`));
    console.log(`photos/${name}-${width}.webp`, info.width, info.height, info.size);
  }
}
