/**
 * Backend integration test against a locally-running `wrangler dev` Worker.
 * Start the worker first:  cd worker && npm run dev
 * Then:                    node scripts/e2e-worker.mjs
 */
import crypto from 'node:crypto';

const API = process.env.API || 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:4321';
const FILE_SECRET = 'dev-only-file-signing-secret-please-change'; // matches worker/.dev.vars
const JWT_SECRET = 'dev-only-jwt-secret-please-change'; // matches worker/.dev.vars
const signJwt = (payload, secret) => {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
};

const tinyPdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let pass = 0, fail = 0;
const ok = (cond, msg) => { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

const post = (path, body, headers = {}) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });

async function run() {
  // preflight
  const pf = await fetch(`${API}/api/apply`, { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  ok(pf.status === 204 && pf.headers.get('access-control-allow-origin') === ORIGIN, `CORS preflight 204 + ACAO (${pf.status})`);

  // forbidden origin
  const bad = await fetch(`${API}/api/apply-begin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  ok(bad.status === 403, `unknown origin rejected (${bad.status})`);

  // begin
  const beginRes = await post('/api/apply-begin', { token: 'dummy' });
  const begin = await beginRes.json();
  ok(beginRes.status === 200 && begin.submissionId && begin.uploadJwt, `apply-begin returns sid + jwt (${beginRes.status})`);
  const jwt = begin.uploadJwt;
  const auth = { Authorization: `Bearer ${jwt}` };

  // upload (3 docs)
  const up = async (docType, name, buf, ctype) =>
    post('/api/upload', buf, { ...auth, 'Content-Type': ctype, 'x-doc-type': docType, 'x-file-name': name });
  const r1 = await up('proofOfIncome', 'paystub.pdf', tinyPdf, 'application/pdf');
  const k1 = (await r1.json()).key;
  const r2 = await up('creditReport', 'credit.pdf', tinyPdf, 'application/pdf');
  const k2 = (await r2.json()).key;
  const r3 = await up('photoId', 'id.png', tinyPng, 'image/png');
  const k3 = (await r3.json()).key;
  ok(r1.status === 200 && k1?.startsWith('applications/'), `upload proofOfIncome (${r1.status})`);
  ok(r3.status === 200 && k3?.endsWith('.png'), `upload photoId png (${r3.status})`);

  // upload rejects unauthorized
  const noauth = await up('proofOfIncome', 'x.pdf', tinyPdf, 'application/pdf').then(() =>
    post('/api/upload', tinyPdf, { 'Content-Type': 'application/pdf', 'x-doc-type': 'proofOfIncome', 'x-file-name': 'x.pdf' })
  );
  ok(noauth.status === 401, `upload without jwt → 401 (${noauth.status})`);

  // upload rejects spoofed type (txt content claiming pdf)
  const spoof = await post('/api/upload', Buffer.from('hello world not a pdf'), { ...auth, 'Content-Type': 'application/pdf', 'x-doc-type': 'proofOfIncome', 'x-file-name': 'fake.pdf' });
  ok(spoof.status === 415, `upload spoofed type rejected by magic-byte sniff (${spoof.status})`);

  // apply (valid) — two-stage: only proof of income up front
  const payload = sampleApplication([k1], [], []);
  const applyRes = await post('/api/apply', payload, auth);
  const applyJson = await applyRes.json();
  ok(applyRes.status === 200 && applyJson.ok, `apply accepts valid payload (${applyRes.status})`);

  // apply rejects invalid payload
  const badApply = await post('/api/apply', { unit: '' }, auth);
  ok(badApply.status === 422, `apply rejects invalid payload → 422 (${badApply.status})`);

  // apply rejects document key from another submission
  const crossKey = 'applications/HN-OTHER/proofOfIncome/aaaa-x.pdf';
  const crossApply = await post('/api/apply', sampleApplication([crossKey], [k2], [k3]), auth);
  ok(crossApply.status === 400, `apply rejects foreign document key → 400 (${crossApply.status})`);

  // signed file download
  const exp = Math.floor(Date.now() / 1000) + 600;
  const sig = b64url(crypto.createHmac('sha256', FILE_SECRET).update(`${k1}.${exp}`).digest());
  const dl = await fetch(`${API}/api/file?k=${encodeURIComponent(k1)}&e=${exp}&s=${sig}`);
  const body = Buffer.from(await dl.arrayBuffer());
  ok(dl.status === 200 && body.length === tinyPdf.length, `signed file download streams the file (${dl.status}, ${body.length}b)`);
  ok((dl.headers.get('content-disposition') || '').includes('attachment'), 'download served as attachment');

  // tampered signature
  const tampered = await fetch(`${API}/api/file?k=${encodeURIComponent(k1)}&e=${exp}&s=${sig.slice(0, -2)}AA`);
  ok(tampered.status === 403, `tampered signature rejected → 403 (${tampered.status})`);

  // expired link
  const past = Math.floor(Date.now() / 1000) - 10;
  const sigPast = b64url(crypto.createHmac('sha256', FILE_SECRET).update(`${k1}.${past}`).digest());
  const expired = await fetch(`${API}/api/file?k=${encodeURIComponent(k1)}&e=${past}&s=${sigPast}`);
  ok(expired.status === 403, `expired link rejected → 403 (${expired.status})`);

  // contact
  const contact = await post('/api/contact', { name: 'Test', email: 't@example.com', phone: '', reason: 'rent', message: 'Hello there', token: 'dummy' });
  ok(contact.status === 200, `contact endpoint accepts message (${contact.status})`);

  // ---- shortlist (second-stage) document flow ----
  const SID = 'HN-SHORTLISTTEST';
  const docReqToken = signJwt({ sid: SID, typ: 'doc-request', name: 'Jordan Test', exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);

  const check = await fetch(`${API}/api/doc-check?token=${encodeURIComponent(docReqToken)}`, { headers: { Origin: ORIGIN } });
  const checkJson = await check.json();
  ok(check.status === 200 && checkJson.valid === true && checkJson.name === 'Jordan Test', `doc-check validates token + name (${check.status})`);

  const dbeg = await post('/api/doc-begin', { token: docReqToken, turnstileToken: 'dummy' });
  const dbegJson = await dbeg.json();
  ok(dbeg.status === 200 && !!dbegJson.uploadJwt, `doc-begin returns upload jwt (${dbeg.status})`);
  const dAuth = { Authorization: `Bearer ${dbegJson.uploadJwt}` };

  const c1 = await post('/api/upload', tinyPdf, { ...dAuth, 'Content-Type': 'application/pdf', 'x-doc-type': 'creditReport', 'x-file-name': 'credit.pdf' });
  const ck = (await c1.json()).key;
  const i1 = await post('/api/upload', tinyPng, { ...dAuth, 'Content-Type': 'image/png', 'x-doc-type': 'photoId', 'x-file-name': 'id.png' });
  const ik = (await i1.json()).key;
  ok(c1.status === 200 && ck.includes(`/${SID}/`), `shortlist upload scoped to submission (${c1.status})`);

  const dsub = await post('/api/doc-submit', { creditReport: [ck], photoId: [ik] }, dAuth);
  ok(dsub.status === 200 && (await dsub.json()).ok, `doc-submit accepts shortlist docs (${dsub.status})`);

  const badBegin = await post('/api/doc-begin', { token: 'bogus.token', turnstileToken: 'dummy' });
  ok(badBegin.status === 403, `doc-begin rejects invalid token → 403 (${badBegin.status})`);

  console.log(`\n${fail === 0 ? 'ALL PASSED ✅' : 'FAILURES ⚠️'}  (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}

function sampleApplication(poi, credit, id) {
  return {
    unit: 'main-unit-1', unitLabel: 'Main-floor Suite — Unit 1', moveInDate: '2026-08-01',
    leaseTerm: '12-month', wantGarage: 'no', hearAbout: 'Website',
    applicant: { fullName: 'Jordan Test', preferredName: '', dob: '1990-05-15', email: 'jordan@example.com', phone: '(780) 555-1234', altPhone: '' },
    residence: { street: '123 Test Ave', city: 'Edmonton', province: 'AB', postal: 'T5T 5T5', ownRent: 'own', currentMoveIn: '2020-01-01', reasonLeaving: 'Relocating', currentRent: 0, landlordName: '', landlordPhone: '', landlordEmail: '', canContactLandlord: '', evicted: 'no', evictedExplain: '', brokeLease: 'no', brokeLeaseExplain: '', previousResidences: [{ street: '9 Old Rd', city: 'Calgary', province: 'AB', postal: 'T2T 2T2', from: '2018-01-01', to: '2019-12-31' }] },
    employment: { status: 'employed-ft', employer: 'Acme', jobTitle: 'Engineer', lengthWithEmployer: '2–5 years', employerPhone: '', grossMonthlyIncome: 6000, additionalIncome: 0 },
    occupants: [{ fullName: 'Jordan Test', dob: '1990-05-15', age: 36, relationship: 'Self', isAdult: true, willCosign: 'no', cosignEmail: '', cosignPhone: '', cosignIncome: 0 }],
    background: { hasPets: 'no', pets: [], serviceAnimal: '', smoking: 'non-smoker', vehicles: [], bankruptcy: 'no', hasGuarantor: 'no', guarantor: { name: '', phone: '', email: '' }, emergencyContacts: [{ name: 'Pat', relationship: 'Friend', phone: '(780) 555-9876' }] },
    documents: { proofOfIncome: poi, creditReport: credit, photoId: id },
    consent: { infoTrue: true, noFeeAck: true, creditConsent: true, privacyConsent: true, signature: 'Jordan Test', signedAt: new Date().toISOString() },
  };
}

run().catch((e) => { console.error(e); process.exit(1); });
