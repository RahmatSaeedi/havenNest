/** Focused check: co-sign radios are mutually exclusive + occupant #1 auto-fills from About You. */
import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4322';

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${BASE}/apply/`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const next = async () => { await page.click('[data-next]'); await page.waitForTimeout(200); };
  const setDate = async (scope, iso) => {
    const [y, m, d] = iso.split('-');
    await page.selectOption(`${scope} .datesel--year`, y);
    await page.selectOption(`${scope} .datesel--month`, m);
    await page.selectOption(`${scope} .datesel--day`, d);
  };

  // Step 1
  await page.selectOption('#f-unit', { index: 1 });
  await page.fill('#f-movein', '2026-09-01');
  await page.check('input[name="wantGarage"][value="no"]');
  await next();
  // Step 2 — About you
  await page.fill('#f-name', 'Alex Sample');
  await setDate('.field:has(#f-dob)', '1985-03-20');
  await page.fill('#f-phone', '7805550000');
  await page.fill('#f-email', 'alex@example.com');
  await page.fill('#f-email2', 'alex@example.com');
  await next();
  // Step 3
  await page.fill('#f-street', '1 Test St');
  await page.fill('#f-city', 'Edmonton');
  await page.fill('#f-postal', 't5t5t5');
  await page.check('input[name="ownRent"][value="own"]');
  await setDate('.field:has(#f-movein-cur)', '2021-06-01');
  await page.fill('#f-reason', 'Test');
  await page.check('input[name="evicted"][value="no"]');
  await page.check('input[name="brokeLease"][value="no"]');
  await next();
  // Step 4
  await page.selectOption('#f-empstatus', 'employed-ft');
  await page.fill('#f-income', '5000');
  await next();
  // Step 5 — Occupants: verify prefill
  await page.waitForTimeout(200);
  const occName = await page.$eval('[data-occupant-card] [data-occ="fullName"]', (e) => e.value);
  const occRel = await page.$eval('[data-occupant-card] [data-occ="relationship"]', (e) => e.value);
  const occDob = await page.$eval('[data-occupant-card] [data-occ="dob"]', (e) => e.value);

  // Mutual exclusivity of co-sign radios
  await page.check('[data-occupant-card] [data-occ="willCosign"][value="yes"]');
  await page.check('[data-occupant-card] [data-occ="willCosign"][value="no"]');
  const yesChecked = await page.$eval('[data-occupant-card] [data-occ="willCosign"][value="yes"]', (e) => e.checked);
  const noChecked = await page.$eval('[data-occupant-card] [data-occ="willCosign"][value="no"]', (e) => e.checked);

  await browser.close();
  const pass =
    occName === 'Alex Sample' &&
    occRel === 'Self' &&
    occDob === '1985-03-20' &&
    yesChecked === false &&
    noChecked === true;
  console.log('occupant #1 name prefilled:', occName, '(expect "Alex Sample")');
  console.log('occupant #1 relationship:', occRel, '(expect "Self")');
  console.log('occupant #1 DOB prefilled:', occDob, '(expect "1985-03-20")');
  console.log('co-sign after Yes then No → yes:', yesChecked, '| no:', noChecked, '(expect false / true)');
  console.log('\n' + (pass ? 'PASS ✅' : 'FAIL ⚠️'));
  process.exit(pass ? 0 : 1);
};
run().catch((e) => { console.error(e); process.exit(1); });
