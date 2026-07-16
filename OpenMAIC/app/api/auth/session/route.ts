import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';

// Public (whitelisted in middleware) so the client can check auth state without a 401.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, user });
}
