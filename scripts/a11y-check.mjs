/**
 * Accessibility audit of the built site using axe-core via the installed Chrome.
 * Requires `astro preview` running on :4321.
 *   node scripts/a11y-check.mjs
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:4321';
const AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const pages = ['/', '/properties/', '/properties/main-unit-1/', '/builder/', '/apply/', '/contact/', '/privacy/', '/documents/?token=test'];

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  let totalSerious = 0;
  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    await page.addScriptTag({ url: AXE });
    const res = await page.evaluate(async () => {
      // @ts-ignore
      const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        n: v.nodes.length,
        nodes: v.nodes.slice(0, 5).map((x) => ({ target: x.target.join(' '), summary: (x.any[0]?.message || x.failureSummary || '').slice(0, 120) })),
      }));
    });
    const serious = res.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    totalSerious += serious.length;
    console.log(`\n${p}`);
    if (res.length === 0) console.log('  ✓ no violations');
    else
      res.forEach((v) => {
        console.log(`  ${v.impact === 'serious' || v.impact === 'critical' ? '✗' : '·'} [${v.impact}] ${v.id} (${v.n})`);
        v.nodes.forEach((node) => console.log(`      ${node.target}  ::  ${node.summary}`));
      });
  }
  await browser.close();
  console.log(`\n${totalSerious === 0 ? 'No serious/critical a11y violations ✅' : `${totalSerious} serious/critical issue(s) ⚠️`}`);
  process.exit(0);
};
run().catch((e) => { console.error(e); process.exit(1); });
