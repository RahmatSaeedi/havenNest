/**
 * Generates HavenNest brand assets into /public from the source logo.
 *
 *   node scripts/make-brand.mjs   (or: npm run brand)
 *
 * The mark is the company's own icon — two hands cradling a house with a
 * padlock — cropped from the top of _brand_src/Logo-wo-bg.png.
 *
 * Produces:
 *   public/images/logo-mark.png        charcoal rounded tile + gold icon (light backgrounds)
 *   public/images/logo-mark-light.png  gold icon, transparent (dark backgrounds)
 *   public/images/logo-wordmark.png    original wordmark, trimmed
 *   public/favicon-16/32/48.png, public/favicon.ico, public/apple-touch-icon.png
 *   public/images/og-image.jpg         1200x630 social card
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const SRC = join(root, '_brand_src', 'Logo-wo-bg.png');
const pub = join(root, 'public');
const img = join(pub, 'images');
mkdirSync(img, { recursive: true });

const CHARCOAL = '#1c1b18';

if (!existsSync(SRC)) {
  console.error('Source logo not found at', SRC);
  process.exit(1);
}

async function run() {
  const meta = await sharp(SRC).metadata();
  const W = meta.width ?? 514;
  const H = meta.height ?? 339;

  // 1) Crop the icon: top ~half of the logo, then trim transparent padding.
  const topRegion = await sharp(SRC)
    .extract({ left: 0, top: 0, width: W, height: Math.round(H * 0.5) })
    .png()
    .toBuffer();
  const iconBuf = await sharp(topRegion).trim({ threshold: 10 }).png().toBuffer();

  // Gold icon on transparent — for dark backgrounds (footer).
  await sharp(iconBuf)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(img, 'logo-mark-light.png'));

  // Charcoal rounded tile + gold icon — for light backgrounds, favicons, header.
  async function tile(size) {
    const pad = Math.round(size * 0.18);
    const inner = size - pad * 2;
    const icon = await sharp(iconBuf)
      .resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const rx = Math.round(size * 0.22);
    const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rx}" fill="${CHARCOAL}"/></svg>`;
    return sharp(Buffer.from(bg)).composite([{ input: icon, gravity: 'center' }]).png().toBuffer();
  }

  writeFileSync(join(img, 'logo-mark.png'), await tile(256));
  const f16 = await tile(16);
  const f32 = await tile(32);
  const f48 = await tile(48);
  writeFileSync(join(pub, 'favicon-16.png'), f16);
  writeFileSync(join(pub, 'favicon-32.png'), f32);
  writeFileSync(join(pub, 'favicon-48.png'), f48);
  writeFileSync(join(pub, 'favicon.ico'), await pngToIco([f16, f32, f48]));
  writeFileSync(join(pub, 'apple-touch-icon.png'), await tile(180));
  console.log('✓ marks + favicons (from real icon)');

  // 2) Wordmark (trim the full logo).
  await sharp(SRC).trim({ threshold: 12 }).resize({ height: 360 }).png().toFile(join(img, 'logo-wordmark.png'));
  const wordmark = await sharp(SRC).trim({ threshold: 12 }).resize({ width: 760 }).png().toBuffer();
  console.log('✓ wordmark');

  // 3) OG card: charcoal + gold frame + centered wordmark.
  const OW = 1200;
  const OH = 630;
  const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="${OW}" height="${OH}">
    <rect width="${OW}" height="${OH}" fill="${CHARCOAL}"/>
    <rect x="28" y="28" width="${OW - 56}" height="${OH - 56}" rx="14" fill="none" stroke="#b8893c" stroke-width="2" opacity="0.55"/>
  </svg>`;
  const wm = await sharp(wordmark).resize({ width: 720 }).toBuffer();
  const wmMeta = await sharp(wm).metadata();
  await sharp({ create: { width: OW, height: OH, channels: 3, background: CHARCOAL } })
    .composite([
      { input: Buffer.from(frame) },
      { input: wm, top: Math.round((OH - (wmMeta.height ?? 380)) / 2), left: Math.round((OW - 720) / 2) },
    ])
    .jpeg({ quality: 86 })
    .toFile(join(img, 'og-image.jpg'));
  console.log('✓ og-image.jpg');

  console.log('\nBrand assets written to /public.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
