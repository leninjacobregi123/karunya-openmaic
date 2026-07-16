import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { recordProgress } from '@/lib/courses/progress-service';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ success: false, error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    classroomId?: string;
    sceneId?: string;
    sceneIndex?: number;
    actionIndex?: number;
    status?: 'in_progress' | 'completed';
    timeSpentMs?: number;
  };
  if (!body.classroomId || !body.sceneId) {
    return NextResponse.json(
      { success: false, error: 'classroomId and sceneId are required' },
      { status: 400 },
    );
  }
  const result = await recordProgress(user, {
    classroomId: body.classroomId,
    sceneId: body.sceneId,
    sceneIndex: body.sceneIndex,
    actionIndex: body.actionIndex,
    status: body.status,
    timeSpentMs: body.timeSpentMs,
  });
  return NextResponse.json({ success: true, ...result });
}
