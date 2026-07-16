import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { getCourseProgress } from '@/lib/courses/progress-service';

/** Teacher report: per-student progress + quiz summary for a course (owner only). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const [course] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  if (!course) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  if (course.ownerId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Not your course' }, { status: 403 });
  }
  const report = await getCourseProgress(id);
  return NextResponse.json({ success: true, ...report });
}
