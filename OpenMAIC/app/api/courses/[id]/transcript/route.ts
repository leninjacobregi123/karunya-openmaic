import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { getStudentTranscript } from '@/lib/courses/progress-service';

/** Teacher report: a single student's chat transcript for a course (owner only). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const studentId = req.nextUrl.searchParams.get('userId');
  if (!studentId) {
    return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
  }
  const [course] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  if (!course) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  if (course.ownerId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Not your course' }, { status: 403 });
  }
  const transcript = await getStudentTranscript(id, studentId);
  return NextResponse.json({ success: true, transcript });
}
