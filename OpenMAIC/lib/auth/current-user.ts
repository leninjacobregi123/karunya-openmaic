/** Read the current session user in route handlers / server components (Node). */
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from './session';
import type { SessionUser } from './types';

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const verified = await verifySessionToken(token);
  return verified?.user ?? null;
}
