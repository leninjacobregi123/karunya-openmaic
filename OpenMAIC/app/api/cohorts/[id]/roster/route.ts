import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { addRosterByEmails } from '@/lib/courses/service';

/**
 * Add students to a cohort. Accepts either JSON {emails:[...]} or a raw CSV body
 * (first column = email; a leading "email" header row is ignored). Missing dev
 * accounts are provisioned (role=student, default dev password).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  const { id: cohortId } = await ctx.params;
  const raw = await req.text();

  let emails: string[] = [];
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json?.emails)) emails = json.emails;
  } catch {
    // not JSON — treat as CSV
  }
  if (emails.length === 0) {
    emails = raw
      .split(/\r?\n/)
      .map((line) => line.split(',')[0].trim())
      .filter((e) => e.includes('@') && e.toLowerCase() !== 'email');
  }
  if (emails.length === 0) {
    return NextResponse.json({ success: false, error: 'no emails provided' }, { status: 400 });
  }

  const result = await addRosterByEmails(cohortId, emails);
  return NextResponse.json({ success: true, ...result });
}
