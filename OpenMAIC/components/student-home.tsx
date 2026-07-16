'use client';

import { useEffect, useState } from 'react';
import { UserMenu } from '@/components/auth/user-menu';
import type { SessionUser } from '@/lib/auth/types';

interface StudentCourse {
  courseId: string;
  title: string;
  description: string | null;
  classroomId: string | null;
  status: string;
}

/**
 * Student "My Courses": server-driven list of enrolled, published courses.
 * Students cannot create courses; the only entry points are their assignments.
 */
export function StudentHome({ user }: { user: SessionUser | null }) {
  const [courses, setCourses] = useState<StudentCourse[] | null>(null);

  useEffect(() => {
    fetch('/api/courses')
      .then((r) => r.json())
      .then((d) => setCourses(d?.courses ?? []))
      .catch(() => setCourses([]));
  }, []);

  return (
    <div className="relative min-h-screen px-6 py-16">
      <div className="fixed right-4 top-4 z-50">
        <UserMenu />
      </div>
      <div className="mx-auto max-w-3xl">
        <img src="/logo-horizontal.png" alt="OpenMAIC" className="mb-3 h-10" />
        <h1 className="text-xl font-semibold text-foreground">My Courses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome{user?.name ? `, ${user.name}` : ''}
        </p>

        <div className="mt-6 space-y-3">
          {courses === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {courses !== null && courses.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You don&rsquo;t have any courses assigned yet. Your teacher will assign courses to
              you.
            </p>
          )}
          {courses?.map((c) => (
            <a
              key={c.courseId}
              href={c.classroomId ? `/classroom/${c.classroomId}` : '#'}
              className="block rounded-xl border border-border/60 bg-white/70 p-4 transition-shadow hover:shadow-md dark:bg-slate-900/70"
            >
              <div className="font-medium text-foreground">{c.title}</div>
              {c.description && (
                <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {c.description}
                </div>
              )}
              <div className="mt-2 text-xs text-muted-foreground">Status: {c.status}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
