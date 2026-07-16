import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { recordQuizResult } from '@/lib/courses/progress-service';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ success: false, error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    classroomId?: string;
    sceneId?: string;
    questionId?: string;
    answerText?: string;
    score?: number;
    maxScore?: number;
    feedback?: string;
  };
  if (!body.classroomId || !body.sceneId) {
    return NextResponse.json(
      { success: false, error: 'classroomId and sceneId are required' },
      { status: 400 },
    );
  }
  const result = await recordQuizResult(user, {
    classroomId: body.classroomId,
    sceneId: body.sceneId,
    questionId: body.questionId,
    answerText: body.answerText,
    score: body.score,
    maxScore: body.maxScore,
    feedback: body.feedback,
  });
  return NextResponse.json({ success: true, ...result });
}
