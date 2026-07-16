import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { recordChatMessage } from '@/lib/courses/progress-service';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ success: false, error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    classroomId?: string;
    sceneId?: string;
    role?: 'student' | 'teacher_agent';
    content?: string;
  };
  if (!body.classroomId || !body.role || !body.content) {
    return NextResponse.json(
      { success: false, error: 'classroomId, role and content are required' },
      { status: 400 },
    );
  }
  const result = await recordChatMessage(user, {
    classroomId: body.classroomId,
    sceneId: body.sceneId,
    role: body.role,
    content: body.content,
  });
  return NextResponse.json({ success: true, ...result });
}
