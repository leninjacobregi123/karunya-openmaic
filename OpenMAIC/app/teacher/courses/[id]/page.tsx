'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { UserMenu } from '@/components/auth/user-menu';

interface StudentRow {
  userId: string;
  name: string;
  email: string;
  enrollmentStatus: string;
  scenesCompleted: number;
  totalScenes: number;
  lastActivity: string | null;
  quizCount: number;
  quizAvgPct: number | null;
}
interface TranscriptLine {
  role: string;
  content: string;
  createdAt: string;
}

export default function CourseProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [title, setTitle] = useState('');
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selected, setSelected] = useState<StudentRow | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[] | null>(null);

  const load = useCallback(async () => {
    const r = await (await fetch(`/api/courses/${id}/progress`)).json();
    setTitle(r?.course?.title ?? 'Course');
    setStudents(r?.students ?? []);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state set post-await
    load();
  }, [load]);

  async function openTranscript(s: StudentRow) {
    setSelected(s);
    setTranscript(null);
    const r = await (await fetch(`/api/courses/${id}/transcript?userId=${s.userId}`)).json();
    setTranscript(r?.transcript ?? []);
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <Link href="/teacher" className="text-xs text-muted-foreground hover:underline">
              ← Back to dashboard
            </Link>
          </div>
          <UserMenu />
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Student</th>
              <th className="py-2">Progress</th>
              <th className="py-2">Quiz</th>
              <th className="py-2">Last activity</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-muted-foreground">
                  No students enrolled yet.
                </td>
              </tr>
            )}
            {students.map((s) => (
              <tr key={s.userId} className="border-b border-border/40">
                <td className="py-2">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </td>
                <td className="py-2">
                  {s.scenesCompleted}/{s.totalScenes}
                </td>
                <td className="py-2">
                  {s.quizAvgPct == null ? '—' : `${s.quizAvgPct}% (${s.quizCount})`}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {s.lastActivity ? new Date(s.lastActivity).toLocaleString() : '—'}
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => openTranscript(s)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Transcript
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {selected && (
          <div className="mt-6 rounded-lg border border-border/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">Transcript — {selected.name}</div>
              <button
                onClick={() => {
                  setSelected(null);
                  setTranscript(null);
                }}
                className="text-xs text-muted-foreground hover:underline"
              >
                Close
              </button>
            </div>
            {transcript === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {transcript !== null && transcript.length === 0 && (
              <p className="text-sm text-muted-foreground">No chat messages.</p>
            )}
            <div className="space-y-2">
              {transcript?.map((m, i) => (
                <div key={i} className="text-sm">
                  <span
                    className={
                      m.role === 'student'
                        ? 'font-medium text-blue-700 dark:text-blue-400'
                        : 'font-medium text-emerald-700 dark:text-emerald-400'
                    }
                  >
                    {m.role === 'student' ? 'Student' : 'AI Teacher'}:
                  </span>{' '}
                  {m.content}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
