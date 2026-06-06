/**
 * End-to-end test of the rental application wizard, driving the installed
 * Chrome via playwright-core. The backend API is mocked so we can exercise the
 * full client flow (steps, validation, occupant co-sign reveal, uploads,
 * payload build, success panel) without the Worker.
 *
 *   node scripts/e2e-apply.mjs
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:4321';
const shot = (name) => `c:\\Users\\rahmat\\AI\\HavenNest Corp\\_shots\\${name}`;

const tinyPdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'utf8');

let capturedApply = null;

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // Mock the Worker API.
  await page.route('https://api.havennest.ca/**', async (route) => {
    const url = route.request().url();
    let body = { ok: true };
    if (url.endsWith('/api/apply-begin')) body = { submissionId: 'HN-TEST-0001', uploadJwt: 'jwt.test.token' };
    else if (url.endsWith('/api/upload')) body = { key: 'applications/HN-TEST-0001/doc' };
    else if (url.endsWith('/api/apply')) {
      capturedApply = JSON.parse(route.request().postData() || '{}');
      body = { ok: true, submissionId: 'HN-TEST-0001' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(`${BASE}/apply/`, { waitUntil: 'networkidle' });

  const clickContinue = async () => { await page.click('[data-next]'); await page.waitForTimeout(150); };
  const setDate = async (scope, iso) => {
    const [y, m, d] = iso.split('-');
    await page.selectOption(`${scope} .datesel--year`, y);
    await page.selectOption(`${scope} .datesel--month`, m);
    await page.selectOption(`${scope} .datesel--day`, d);
  };

  // STEP 1 — Unit & move-in
  await page.selectOption('#f-unit', { index: 1 });
  await page.fill('#f-movein', '2026-08-01');
  await page.check('input[name="wantGarage"][value="no"]');
  await clickContinue();

  // STEP 2 — About you (DOB is now Year/Month/Day selects)
  await page.fill('#f-name', 'Jordan Test Applicant');
  await setDate('.field:has(#f-dob)', '1990-05-15');
  await page.fill('#f-phone', '7805551234');
  await page.fill('#f-email', 'jordan@example.com');
  await page.fill('#f-email2', 'jordan@example.com');
  await clickContinue();

  // STEP 3 — Residence (own, to skip landlord block)
  await page.fill('#f-street', '123 Test Ave NW');
  await page.fill('#f-city', 'Edmonton');
  await page.fill('#f-postal', 't5t5t5');
  await page.check('input[name="ownRent"][value="own"]');
  await setDate('.field:has(#f-movein-cur)', '2020-01-01');
  await page.fill('#f-reason', 'Relocating for work.');
  await page.check('input[name="evicted"][value="no"]');
  await page.check('input[name="brokeLease"][value="no"]');
  await clickContinue();

  // STEP 4 — Employment & income
  await page.selectOption('#f-empstatus', 'employed-ft');
  await page.fill('#f-income', '6000');
  await clickContinue();

  // STEP 5 — Occupants (first card exists). Make an adult + co-signer to test reveal.
  await page.fill('[data-occupant-card] [data-occ="fullName"]', 'Jordan Test Applicant');
  await setDate('[data-occupant-card]', '1990-05-15');
  await page.selectOption('[data-occupant-card] [data-occ="relationship"]', 'Self');
  await page.waitForTimeout(120);
  const cosignVisible = await page.$eval('[data-occ-cosign]', (e) => !e.hidden).catch(() => false);
  await page.check('[data-occ="willCosign"][value="yes"]');
  await page.waitForTimeout(120);
  await page.fill('[data-occ="cosignEmail"]', 'jordan@example.com');
  await page.fill('[data-occ="cosignPhone"]', '7805551234');
  await clickContinue();

  // STEP 6 — Background (emergency contacts are a repeatable group; one card exists)
  await page.check('input[name="hasPets"][value="no"]');
  await page.check('input[name="smoking"][value="non-smoker"]');
  await page.check('input[name="hasGuarantor"][value="no"]');
  await page.fill('[data-emergency-card] [data-emerg="name"]', 'Pat Contact');
  await page.fill('[data-emergency-card] [data-emerg="relationship"]', 'Friend');
  await page.fill('[data-emergency-card] [data-emerg="phone"]', '7805559876');
  await clickContinue();

  // STEP 7 — Documents (two-stage: only proof of income up front)
  await page.setInputFiles('#doc-proofOfIncome', [{ name: 'paystub.pdf', mimeType: 'application/pdf', buffer: tinyPdf }]);
  const noIdUpfront = (await page.$('#doc-photoId')) === null && (await page.$('#doc-creditReport')) === null;
  await page.waitForTimeout(150);
  await clickContinue();

  // STEP 8 — Review & consent
  const reviewText = await page.$eval('[data-review]', (e) => e.textContent).catch(() => '');
  await page.check('input[name="infoTrue"]');
  await page.check('input[name="noFeeAck"]');
  await page.check('input[name="creditConsent"]');
  await page.check('input[name="privacyConsent"]');
  await page.fill('#f-sign', 'Jordan Test Applicant');

  // Wait for Turnstile token (test sitekey auto-passes).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[name="cf-turnstile-response"]');
      return el && el.value && el.value.length > 0;
    },
    { timeout: 8000 }
  ).catch(() => console.log('  (turnstile token not detected — will still try submit)'));

  await page.screenshot({ path: shot('apply-step8.png') });
  await page.click('[data-submit]');

  // Wait for success panel.
  await page.waitForSelector('[data-success]:not([hidden])', { timeout: 8000 }).catch(() => {});
  const success = await page.$eval('[data-success]', (e) => !e.hidden).catch(() => false);
  const ref = await page.$eval('[data-success-ref]', (e) => e.textContent).catch(() => '');
  await page.screenshot({ path: shot('apply-success.png') });

  // Report
  console.log('--- E2E RESULTS ---');
  console.log('co-sign block revealed for adult:', cosignVisible);
  console.log('ID + credit NOT requested up front:', noIdUpfront);
  console.log('review contained applicant name:', /Jordan Test Applicant/.test(reviewText));
  console.log('success panel shown:', success, '| ref:', ref.trim());
  if (capturedApply) {
    console.log('payload.unit:', capturedApply.unit);
    console.log('payload.applicant.email:', capturedApply.applicant?.email);
    console.log('payload.occupants[0]:', JSON.stringify(capturedApply.occupants?.[0]));
    console.log('payload.documents:', JSON.stringify(capturedApply.documents));
    console.log('payload.emergencyContacts:', JSON.stringify(capturedApply.background?.emergencyContacts));
    console.log('payload.consent.signature:', capturedApply.consent?.signature);
    console.log('payload.employment.grossMonthlyIncome:', capturedApply.employment?.grossMonthlyIncome);
  } else {
    console.log('!! /api/apply was never called');
  }
  console.log('console errors:', errors.length ? errors : 'none');

  await browser.close();
  const dobOk = capturedApply?.occupants?.[0]?.dob === '1990-05-15'; // date-selects worked
  const emergOk = (capturedApply?.background?.emergencyContacts?.length || 0) >= 1;
  console.log('occupant DOB via selects:', dobOk, '| emergency contacts captured:', emergOk);
  const pass =
    success &&
    capturedApply &&
    /Jordan/.test(capturedApply.applicant?.fullName || '') &&
    dobOk &&
    emergOk &&
    errors.length === 0;
  console.log('\nE2E', pass ? 'PASSED ✅' : 'NEEDS ATTENTION ⚠️');
  process.exit(pass ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });
