/** Minimal HMAC-SHA256 JWT-style token (sign/verify) using Web Crypto. */

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export interface TokenPayload {
  sid: string;
  exp: number; // epoch seconds
  [k: string]: unknown;
}

export async function sign(payload: TokenPayload, secret: string): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verify(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      b64urlDecode(sig),
      new TextEncoder().encode(body)
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Stateless signed download link: HMAC over `${key}.${exp}`. */
export async function signLink(objectKey: string, exp: number, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    new TextEncoder().encode(`${objectKey}.${exp}`)
  );
  return b64urlEncode(sig);
}
export async function verifyLink(
  objectKey: string,
  exp: number,
  sig: string,
  secret: string
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await signLink(objectKey, exp, secret);
  // constant-time-ish compare
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
