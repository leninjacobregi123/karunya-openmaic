import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { createCohort, listCohorts } from '@/lib/courses/service';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  const cohorts = await listCohorts(user.id);
  return NextResponse.json({ success: true, cohorts });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
  }
  const cohort = await createCohort({ ownerId: user.id, name: body.name.trim() });
  return NextResponse.json({ success: true, cohort });
}
