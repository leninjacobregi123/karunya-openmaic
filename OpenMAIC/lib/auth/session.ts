/**
 * Stateless signed session tokens, verifiable in BOTH the Edge runtime
 * (middleware) and Node (route handlers). Uses Web Crypto HMAC only — NO node
 * imports — mirroring OpenMAIC's existing ACCESS_CODE token approach.
 *
 * Token = base64url(JSON payload) + "." + hex HMAC-SHA256(body, SESSION_SECRET).
 * Payload carries identity + role + exp, so middleware can authenticate and do
 * RBAC without a DB/Redis round-trip. (Redis-backed revocation can be layered on
 * later in Node-side handlers; Edge can't reach Redis.)
 */
import type { SessionUser } from './types';

export const SESSION_COOKIE = 'maic_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h

const secret = () => process.env.SESSION_SECRET || 'dev-session-secret-change-me';

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += '='.repeat(pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface Payload extends SessionUser {
  iat: number;
  exp: number;
}

export async function createSessionToken(
  user: SessionUser,
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { ...user, iat: now, exp: now + ttlSeconds };
  const body = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacHex(body);
  return `${body}.${sig}`;
}

export async function verifySessionToken(
  token: string,
): Promise<{ user: SessionUser; exp: number } | null> {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = await hmacHex(body);
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(body)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

  return {
    user: { id: payload.id, email: payload.email, name: payload.name, role: payload.role },
    exp: payload.exp,
  };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS,
  };
}
