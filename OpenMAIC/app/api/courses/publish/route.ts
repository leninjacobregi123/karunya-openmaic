import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { publishCourse } from '@/lib/courses/service';
import { createLogger } from '@/lib/logger';

const log = createLogger('Courses/publish');

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      classroomId?: string;
      title?: string;
      description?: string;
    };
    if (!body.classroomId) {
      return NextResponse.json(
        { success: false, error: 'classroomId is required' },
        { status: 400 },
      );
    }
    const { course, version } = await publishCourse({
      ownerId: user.id,
      classroomId: body.classroomId,
      title: body.title,
      description: body.description,
    });
    return NextResponse.json({ success: true, course, version });
  } catch (e) {
    log.error('publish failed:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'publish failed' },
      { status: 500 },
    );
  }
}
