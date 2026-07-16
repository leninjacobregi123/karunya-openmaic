/**
 * Client-side playback telemetry → server persistence (Phase 3).
 * Fire-and-forget POSTs; the server attributes them to the student's enrolled
 * course version and no-ops for non-students. classroomId is derived from the
 * /classroom/[id] URL so callers don't need to thread it through props.
 */
function classroomIdFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  const m = location.pathname.match(/\/classroom\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function send(path: string, body: Record<string, unknown>) {
  const classroomId = classroomIdFromUrl();
  if (!classroomId) return;
  try {
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classroomId, ...body }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

export function reportProgress(p: {
  sceneId: string;
  sceneIndex?: number;
  status?: 'in_progress' | 'completed';
  timeSpentMs?: number;
}) {
  send('/api/progress', p);
}

export function reportQuizResult(q: {
  sceneId: string;
  questionId?: string;
  answerText?: string;
  score?: number;
  maxScore?: number;
  feedback?: string;
}) {
  send('/api/quiz-result', q);
}

export function reportChat(c: {
  sceneId?: string;
  role: 'student' | 'teacher_agent';
  content: string;
}) {
  send('/api/chat-log', c);
}
