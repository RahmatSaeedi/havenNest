import { applicationSchema, contactSchema, docSubmitSchema } from './schema';
import { sign, verify, signLink, verifyLink, type TokenPayload } from './jwt';
import {
  buildApplicationEmail,
  buildContactEmail,
  buildShortlistDocsEmail,
  sendOwnerEmail,
  type DocLink,
} from './email';

export interface Env {
  UPLOADS: R2Bucket;
  SEND_EMAIL?: { send: (m: unknown) => Promise<void> };
  TURNSTILE_SECRET: string;
  JWT_SECRET: string;
  FILE_SIGNING_SECRET: string;
  FROM_EMAIL: string;
  OWNER_EMAIL: string;
  REPLY_TO?: string;
  PUBLIC_API_BASE: string;
  SITE_BASE: string;
  ALLOWED_ORIGINS: string;
  FILE_LINK_TTL_DAYS?: string;
  DOC_REQUEST_TTL_DAYS?: string;
  DISABLE_EMAIL?: string;
}

const DOC_TYPES = ['proofOfIncome', 'creditReport', 'photoId'] as const;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const JWT_TTL_SECONDS = 30 * 60;

/* ----------------------------- CORS ----------------------------- */
function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}
function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-doc-type, x-file-name',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/* ------------------------- Turnstile ---------------------------- */
async function verifyTurnstile(token: string, ip: string | null, secret: string): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = (await res.json()) as { success: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

/* ----------------------- file type sniff ------------------------ */
function sniff(bytes: Uint8Array): { mime: string; ext: string } | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return { mime: 'image/webp', ext: 'webp' };
  return null;
}
function safeName(name: string): string {
  return (name || 'file')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'file';
}

async function requireAuth(req: Request, env: Env): Promise<TokenPayload | null> {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verify(m[1], env.JWT_SECRET);
}

/** Confirm every key belongs to this submission and exists in R2. */
async function verifyKeysOwned(env: Env, sid: string, keys: string[]): Promise<string | null> {
  const prefix = `applications/${sid}/`;
  for (const k of keys) {
    if (!k.startsWith(prefix)) return 'bad_document_key';
    const head = await env.UPLOADS.head(k);
    if (!head) return 'missing_document';
  }
  return null;
}

/** Build signed, time-limited download links for grouped document keys. */
async function buildDocLinks(env: Env, grouped: Record<string, string[]>): Promise<DocLink[]> {
  const ttlDays = Number(env.FILE_LINK_TTL_DAYS || '14');
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const out: DocLink[] = [];
  for (const type of Object.keys(grouped)) {
    for (const key of grouped[type]) {
      const s = await signLink(key, exp, env.FILE_SIGNING_SECRET);
      const url = `${env.PUBLIC_API_BASE}/api/file?k=${encodeURIComponent(key)}&e=${exp}&s=${s}`;
      const name = key.split('/').pop()!.replace(/^[0-9a-f]{8}-/, '');
      out.push({ type, name, url });
    }
  }
  return out;
}

/* ----------------------------- routes --------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const origin = allowedOrigin(req, env);
    const ip = req.headers.get('CF-Connecting-IP');

    // Preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // GET /api/file — signed document download (clicked from the owner email)
    if (req.method === 'GET' && path === '/api/file') {
      return handleFileDownload(url, env);
    }
    // GET /api/doc-check — validate a shortlist upload token (greeting / expiry UX)
    if (req.method === 'GET' && path === '/api/doc-check') {
      return handleDocCheck(url, env, origin);
    }

    if (req.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, origin);
    }
    // For state-changing routes, require a known browser origin.
    if (!origin) return json({ error: 'forbidden_origin' }, 403, origin);

    try {
      if (path === '/api/apply-begin') return await handleBegin(req, env, origin, ip);
      if (path === '/api/upload') return await handleUpload(req, env, origin);
      if (path === '/api/apply') return await handleApply(req, env, origin);
      if (path === '/api/contact') return await handleContact(req, env, origin, ip);
      if (path === '/api/doc-begin') return await handleDocBegin(req, env, origin, ip);
      if (path === '/api/doc-submit') return await handleDocSubmit(req, env, origin);
      return json({ error: 'not_found' }, 404, origin);
    } catch (err) {
      console.error('Worker error', path, err);
      return json({ error: 'server_error' }, 500, origin);
    }
  },
};

async function handleBegin(req: Request, env: Env, origin: string, ip: string | null): Promise<Response> {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const ok = await verifyTurnstile(token || '', ip, env.TURNSTILE_SECRET);
  if (!ok) return json({ error: 'turnstile_failed' }, 400, origin);

  const sid = 'HN-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const exp = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;
  const uploadJwt = await sign({ sid, exp }, env.JWT_SECRET);
  return json({ submissionId: sid, uploadJwt }, 200, origin);
}

async function handleUpload(req: Request, env: Env, origin: string): Promise<Response> {
  const auth = await requireAuth(req, env);
  if (!auth) return json({ error: 'unauthorized' }, 401, origin);

  const docType = req.headers.get('x-doc-type') || '';
  if (!(DOC_TYPES as readonly string[]).includes(docType)) return json({ error: 'bad_doc_type' }, 400, origin);

  const lenHeader = Number(req.headers.get('Content-Length') || '0');
  if (lenHeader && lenHeader > MAX_FILE_BYTES) return json({ error: 'file_too_large' }, 413, origin);

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) return json({ error: 'empty_file' }, 400, origin);
  if (buf.byteLength > MAX_FILE_BYTES) return json({ error: 'file_too_large' }, 413, origin);

  const kind = sniff(buf);
  if (!kind) return json({ error: 'unsupported_file_type' }, 415, origin);

  const rawName = decodeURIComponent(req.headers.get('x-file-name') || 'file');
  let base = safeName(rawName);
  if (!base.toLowerCase().endsWith('.' + kind.ext)) base += '.' + kind.ext;

  const key = `applications/${auth.sid}/${docType}/${crypto.randomUUID().slice(0, 8)}-${base}`;
  await env.UPLOADS.put(key, buf, {
    httpMetadata: {
      contentType: kind.mime,
      contentDisposition: `attachment; filename="${base}"`,
    },
  });
  return json({ key }, 200, origin);
}

async function handleApply(req: Request, env: Env, origin: string): Promise<Response> {
  const auth = await requireAuth(req, env);
  if (!auth) return json({ error: 'unauthorized' }, 401, origin);

  const raw = await req.json().catch(() => null);
  const parsed = applicationSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'validation_failed', issues: parsed.error.issues.slice(0, 10) }, 422, origin);
  }
  const app = parsed.data;

  // Verify every referenced document belongs to this submission and exists.
  const grouped = {
    proofOfIncome: app.documents.proofOfIncome,
    creditReport: app.documents.creditReport,
    photoId: app.documents.photoId,
  };
  const keyErr = await verifyKeysOwned(env, auth.sid, Object.values(grouped).flat());
  if (keyErr) return json({ error: keyErr }, 400, origin);

  const docs = await buildDocLinks(env, grouped);

  // Mint a long-lived, signed "shortlist upload" link the owner can forward to
  // the applicant if they advance — collects ID + credit report at that stage.
  const docTtlDays = Number(env.DOC_REQUEST_TTL_DAYS || '30');
  const docReqExp = Math.floor(Date.now() / 1000) + docTtlDays * 86400;
  const docReqToken = await sign(
    { sid: auth.sid, typ: 'doc-request', name: app.applicant.fullName, email: app.applicant.email, exp: docReqExp },
    env.JWT_SECRET
  );
  const docRequestUrl = `${env.SITE_BASE}/documents?token=${encodeURIComponent(docReqToken)}`;

  const email = buildApplicationEmail(app, docs, auth.sid, docRequestUrl, docTtlDays);
  await sendOwnerEmail(env, email);

  return json({ ok: true, submissionId: auth.sid }, 200, origin);
}

async function handleContact(req: Request, env: Env, origin: string, ip: string | null): Promise<Response> {
  const raw = await req.json().catch(() => null);
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'validation_failed' }, 422, origin);
  const c = parsed.data;

  const ok = await verifyTurnstile(c.token, ip, env.TURNSTILE_SECRET);
  if (!ok) return json({ error: 'turnstile_failed' }, 400, origin);

  const email = buildContactEmail(c);
  await sendOwnerEmail({ ...env, REPLY_TO: c.email }, email);
  return json({ ok: true }, 200, origin);
}

async function handleDocCheck(url: URL, env: Env, origin: string | null): Promise<Response> {
  const token = url.searchParams.get('token') || '';
  const payload = await verify(token, env.JWT_SECRET);
  const valid = !!payload && payload.typ === 'doc-request';
  return json({ valid, name: valid ? String(payload!.name ?? '') : '' }, 200, origin);
}

async function handleDocBegin(req: Request, env: Env, origin: string, ip: string | null): Promise<Response> {
  const { token, turnstileToken } = (await req.json().catch(() => ({}))) as {
    token?: string;
    turnstileToken?: string;
  };
  const ok = await verifyTurnstile(turnstileToken || '', ip, env.TURNSTILE_SECRET);
  if (!ok) return json({ error: 'turnstile_failed' }, 400, origin);

  const payload = await verify(token || '', env.JWT_SECRET);
  if (!payload || payload.typ !== 'doc-request') return json({ error: 'invalid_link' }, 403, origin);

  const exp = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;
  const uploadJwt = await sign({ sid: String(payload.sid), name: payload.name, exp }, env.JWT_SECRET);
  return json({ submissionId: String(payload.sid), uploadJwt, applicantName: String(payload.name ?? '') }, 200, origin);
}

async function handleDocSubmit(req: Request, env: Env, origin: string): Promise<Response> {
  const auth = await requireAuth(req, env);
  if (!auth) return json({ error: 'unauthorized' }, 401, origin);

  const raw = await req.json().catch(() => null);
  const parsed = docSubmitSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'validation_failed' }, 422, origin);

  const grouped = { creditReport: parsed.data.creditReport, photoId: parsed.data.photoId };
  const keys = Object.values(grouped).flat();
  if (keys.length === 0) return json({ error: 'no_documents' }, 400, origin);

  const keyErr = await verifyKeysOwned(env, auth.sid, keys);
  if (keyErr) return json({ error: keyErr }, 400, origin);

  const docs = await buildDocLinks(env, grouped);
  const name = typeof auth.name === 'string' && auth.name ? auth.name : auth.sid;
  await sendOwnerEmail(env, buildShortlistDocsEmail(name, auth.sid, docs));
  return json({ ok: true, submissionId: auth.sid }, 200, origin);
}

async function handleFileDownload(url: URL, env: Env): Promise<Response> {
  const k = url.searchParams.get('k') || '';
  const e = Number(url.searchParams.get('e') || '0');
  const s = url.searchParams.get('s') || '';
  if (!k || !s || !(await verifyLink(k, e, s, env.FILE_SIGNING_SECRET))) {
    return new Response('Link invalid or expired.', { status: 403 });
  }
  const obj = await env.UPLOADS.get(k);
  if (!obj) return new Response('Not found.', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Disposition', obj.httpMetadata?.contentDisposition || 'attachment');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(obj.body, { headers });
}
