import { NextRequest, NextResponse } from 'next/server';
import { getAuthProvider } from '@/lib/auth/provider';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { createLogger } from '@/lib/logger';

const log = createLogger('Auth/login');

export async function POST(req: NextRequest) {
  let email: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    email = body.email;
    if (!body.email || !body.password) {
      return NextResponse.json(
        { success: false, error: 'email and password are required' },
        { status: 400 },
      );
    }
    const user = await getAuthProvider().verifyCredentials(body.email, body.password);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }
    const token = await createSessionToken(user);
    const res = NextResponse.json({ success: true, user });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    log.error(`login failed [email=${email ?? '?'}]:`, e);
    return NextResponse.json({ success: false, error: 'Login failed' }, { status: 500 });
  }
}
