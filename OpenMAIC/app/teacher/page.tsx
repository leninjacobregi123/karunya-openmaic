'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { UserMenu } from '@/components/auth/user-menu';

interface DiskClassroom {
  id: string;
  name: string;
  scenes: number;
  createdAt: string;
}
interface TeacherCourse {
  courseId: string;
  title: string;
  description: string | null;
  classroomId: string | null;
  versionId: string | null;
}
interface CohortRow {
  id: string;
  name: string;
  members: number;
}

async function jget(url: string) {
  const r = await fetch(url);
  return r.json();
}
async function jpost(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export default function TeacherDashboard() {
  const [classrooms, setClassrooms] = useState<DiskClassroom[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const reload = useCallback(async () => {
    const [c1, c2, c3] = await Promise.all([
      jget('/api/classrooms'),
      jget('/api/courses'),
      jget('/api/cohorts'),
    ]);
    setClassrooms(c1?.classrooms ?? []);
    setCourses(c2?.courses ?? []);
    setCohorts(c3?.cohorts ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state set post-await
    reload();
  }, [reload]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 4000);
  };

  async function publish(classroomId: string) {
    setBusy(true);
    const r = await jpost('/api/courses/publish', { classroomId });
    setBusy(false);
    flash(r?.success ? `Published "${r.course.title}"` : `Publish failed: ${r?.error}`);
    if (r?.success) reload();
  }

  // Per-course selected cohort for assignment
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  async function assign(course: TeacherCourse) {
    const cohortId = assignSel[course.courseId];
    if (!cohortId || !course.versionId) return flash('Pick a cohort first');
    setBusy(true);
    const r = await jpost('/api/courses/assign', {
      courseId: course.courseId,
      courseVersionId: course.versionId,
      cohortId,
    });
    setBusy(false);
    flash(r?.success ? `Assigned to ${r.enrolled} student(s)` : `Assign failed: ${r?.error}`);
    if (r?.success) reload();
  }

  const [cohortName, setCohortName] = useState('');
  async function createCohort() {
    if (!cohortName.trim()) return;
    setBusy(true);
    const r = await jpost('/api/cohorts', { name: cohortName.trim() });
    setBusy(false);
    setCohortName('');
    flash(r?.success ? `Created cohort "${r.cohort.name}"` : `Failed: ${r?.error}`);
    if (r?.success) reload();
  }

  const [rosterFor, setRosterFor] = useState<string>('');
  const [rosterText, setRosterText] = useState('');
  async function uploadRoster() {
    if (!rosterFor || !rosterText.trim()) return flash('Pick a cohort and paste emails');
    const emails = rosterText
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'));
    setBusy(true);
    const r = await jpost(`/api/cohorts/${rosterFor}/roster`, { emails });
    setBusy(false);
    setRosterText('');
    flash(r?.success ? `Roster: +${r.added} (created ${r.created})` : `Failed: ${r?.error}`);
    if (r?.success) reload();
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Teacher Dashboard</h1>
            <Link href="/" className="text-xs text-muted-foreground hover:underline">
              ← Back to course creation
            </Link>
          </div>
          <UserMenu />
        </div>

        {msg && (
          <div className="mb-4 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
            {msg}
          </div>
        )}

        {/* Publish */}
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Generated classrooms — publish to assign
          </h2>
          <div className="space-y-2">
            {classrooms.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No generated classrooms found. Create one from the home page first.
              </p>
            )}
            {classrooms.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-border/60 p-3"
              >
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.scenes} scenes · {c.id}
                  </div>
                </div>
                <button
                  disabled={busy}
                  onClick={() => publish(c.id)}
                  className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
                >
                  Publish
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Courses + assign */}
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Published courses
          </h2>
          <div className="space-y-2">
            {courses.length === 0 && (
              <p className="text-sm text-muted-foreground">No published courses yet.</p>
            )}
            {courses.map((c) => (
              <div key={c.courseId} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{c.title}</div>
                  <Link
                    href={`/teacher/courses/${c.courseId}`}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View progress →
                  </Link>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={assignSel[c.courseId] ?? ''}
                    onChange={(e) => setAssignSel((s) => ({ ...s, [c.courseId]: e.target.value }))}
                    className="rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs"
                  >
                    <option value="">Assign to cohort…</option>
                    {cohorts.map((co) => (
                      <option key={co.id} value={co.id}>
                        {co.name} ({co.members})
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy}
                    onClick={() => assign(c)}
                    className="rounded-md border border-border/60 px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    Assign
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Cohorts */}
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Cohorts
          </h2>
          <div className="mb-3 flex items-center gap-2">
            <input
              value={cohortName}
              onChange={(e) => setCohortName(e.target.value)}
              placeholder="New cohort name"
              className="flex-1 rounded-md border border-border/60 bg-transparent px-3 py-1.5 text-sm"
            />
            <button
              disabled={busy}
              onClick={createCohort}
              className="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              Create
            </button>
          </div>
          <ul className="mb-4 space-y-1 text-sm">
            {cohorts.map((co) => (
              <li key={co.id} className="text-muted-foreground">
                {co.name} — {co.members} student(s)
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-border/60 p-3">
            <div className="mb-2 text-xs font-medium">Upload roster (emails)</div>
            <select
              value={rosterFor}
              onChange={(e) => setRosterFor(e.target.value)}
              className="mb-2 w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs"
            >
              <option value="">Select cohort…</option>
              {cohorts.map((co) => (
                <option key={co.id} value={co.id}>
                  {co.name}
                </option>
              ))}
            </select>
            <textarea
              value={rosterText}
              onChange={(e) => setRosterText(e.target.value)}
              placeholder="student1@karunya.edu, student2@karunya.edu …  (comma, space, or newline separated; CSV first column also works)"
              className="h-24 w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs"
            />
            <button
              disabled={busy}
              onClick={uploadRoster}
              className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
            >
              Add to cohort
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
