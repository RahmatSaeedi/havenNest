/**
 * Optimizes the source /Photographs into web assets + a manifest.
 *
 *   node scripts/process-photos.mjs   (or: npm run photos)
 *
 * For each photo it writes a grid thumbnail and a full-size (lightbox) image as
 * WebP into public/images/properties/<category>/, copies the construction video,
 * and emits src/data/photos.json consumed by the gallery components.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import { mkdirSync, rmSync, readdirSync, existsSync, copyFileSync, writeFileSync, statSync } from 'node:fs';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const SRC = join(root, 'Photographs');
const OUT = join(root, 'public', 'images', 'properties');
const MANIFEST = join(root, 'src', 'data', 'photos.json');

const THUMB_W = 900;
const FULL_W = 2000;
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Natural sort so MAINFLOOR2 comes before MAINFLOOR10. */
const natCompare = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const categories = {
  exterior: {
    dir: SRC,
    match: (f) => /exterior/i.test(f) && IMG_EXT.has(extname(f).toLowerCase()),
    alt: (i) => `HavenNest fourplex exterior, 9911 158 Street NW, Edmonton — view ${i}`,
  },
  main: {
    dir: join(SRC, 'Finished Main Floor'),
    match: (f) => IMG_EXT.has(extname(f).toLowerCase()),
    alt: (i) => `HavenNest main-floor suite interior — brand-new finishes, view ${i}`,
  },
  basement: {
    dir: join(SRC, 'Finished Basement'),
    match: (f) => IMG_EXT.has(extname(f).toLowerCase()),
    alt: (i) => `HavenNest legal basement suite interior — brand-new finishes, view ${i}`,
  },
  construction: {
    dir: join(SRC, 'Construction of the property'),
    match: (f) => IMG_EXT.has(extname(f).toLowerCase()),
    alt: (i) => `HavenNest construction progress at 9911 158 Street NW — stage ${i}`,
  },
};

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
}

async function processImage(srcPath, outDir, slug, alt) {
  const base = sharp(srcPath, { failOn: 'none' }).rotate();
  const meta = await base.metadata();
  const w = meta.width ?? FULL_W;
  const h = meta.height ?? Math.round(FULL_W * 0.66);
  const ratio = h / w;

  await sharp(srcPath, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_W, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(join(outDir, `${slug}-thumb.webp`));

  const fullW = Math.min(w, FULL_W);
  await sharp(srcPath, { failOn: 'none' })
    .rotate()
    .resize({ width: FULL_W, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(join(outDir, `${slug}.webp`));

  return {
    thumb: `/images/properties/${basename(outDir)}/${slug}-thumb.webp`,
    full: `/images/properties/${basename(outDir)}/${slug}.webp`,
    w: fullW,
    h: Math.round(fullW * ratio),
    alt,
  };
}

async function run() {
  if (!existsSync(SRC)) {
    console.error('Photographs/ folder not found at', SRC);
    process.exit(1);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const manifest = {};

  for (const [name, cfg] of Object.entries(categories)) {
    const outDir = join(OUT, name);
    mkdirSync(outDir, { recursive: true });
    const files = listFiles(cfg.dir).filter(cfg.match).sort(natCompare);
    const items = [];
    let i = 0;
    for (const f of files) {
      i += 1;
      const slug = `${name}-${String(i).padStart(2, '0')}`;
      try {
        const item = await processImage(join(cfg.dir, f), outDir, slug, cfg.alt(i));
        items.push(item);
      } catch (e) {
        console.warn(`  ! skipped ${f}: ${e.message}`);
      }
    }
    manifest[name] = items;
    console.log(`✓ ${name}: ${items.length} image(s)`);
  }

  // Construction walkthrough video → copy + reuse a construction still as poster.
  const constructionDir = categories.construction.dir;
  const video = listFiles(constructionDir).find((f) => /\.(mp4|webm|mov)$/i.test(f));
  if (video) {
    const outDir = join(OUT, 'construction');
    const dest = `walkthrough${extname(video).toLowerCase()}`;
    copyFileSync(join(constructionDir, video), join(outDir, dest));
    manifest.video = {
      src: `/images/properties/construction/${dest}`,
      poster: manifest.construction?.[0]?.full ?? null,
    };
    console.log(`✓ video: ${dest}`);
  } else {
    manifest.video = null;
  }

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log('\nManifest written to src/data/photos.json');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
