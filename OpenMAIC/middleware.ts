import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

// Reachable without a session.
const PUBLIC_PREFIXES = ['/login', '/api/auth/', '/api/health'];
function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Course-authoring / creation surface — teacher & admin only. Students keep the
 * playback-time endpoints (chat, tts, quiz-grade, classroom GET, classroom-media).
 */
function isTeacherOnly(req: NextRequest): boolean {
  const p = req.nextUrl.pathname;
  const m = req.method;
  if (p === '/api/generate-classroom') return true;
  if (p.startsWith('/api/generate/scene')) return true;
  if (p === '/api/generate/image' || p === '/api/generate/video') return true;
  if (p === '/api/classroom' && m !== 'GET') return true;
  if (p === '/api/courses/publish' || p === '/api/courses/assign') return true;
  if (p.startsWith('/api/courses/') && (p.endsWith('/progress') || p.endsWith('/transcript')))
    return true;
  if (p.startsWith('/api/cohorts')) return true;
  if (p === '/api/classrooms') return true; // publish-source list (teacher)
  if (p === '/generation-preview') return true;
  if (p === '/teacher' || p.startsWith('/teacher/')) return true;
  return false;
}

function unauthorized(req: NextRequest, status: 401 | 403, code: string, msg: string) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ success: false, errorCode: code, error: msg }, { status });
  }
  const url = req.nextUrl.clone();
  if (status === 401) {
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
  } else {
    url.pathname = '/';
    url.search = '';
  }
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    return unauthorized(request, 401, 'UNAUTHENTICATED', 'Login required');
  }

  if (session.user.role === 'student' && isTeacherOnly(request)) {
    return unauthorized(request, 403, 'FORBIDDEN', 'This action is restricted to teachers');
  }

  // Make identity available to downstream route handlers without re-verifying.
  const headers = new Headers(request.headers);
  headers.set('x-user-id', session.user.id);
  headers.set('x-user-role', session.user.role);
  headers.set('x-user-email', session.user.email);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
