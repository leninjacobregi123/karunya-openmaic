import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { assignCourseToCohort } from '@/lib/courses/service';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    courseId?: string;
    courseVersionId?: string;
    cohortId?: string;
  };
  if (!body.courseId || !body.courseVersionId || !body.cohortId) {
    return NextResponse.json(
      { success: false, error: 'courseId, courseVersionId and cohortId are required' },
      { status: 400 },
    );
  }
  const result = await assignCourseToCohort({
    courseId: body.courseId,
    courseVersionId: body.courseVersionId,
    cohortId: body.cohortId,
  });
  return NextResponse.json({ success: true, ...result });
}
