import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { listCoursesForStudent, listCoursesForTeacher } from '@/lib/courses/service';

/** Role-aware course list: teachers see owned courses, students see enrolled. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ success: false, error: 'unauthenticated' }, { status: 401 });
  const courses =
    user.role === 'teacher' || user.role === 'admin'
      ? await listCoursesForTeacher(user.id)
      : await listCoursesForStudent(user.id);
  return NextResponse.json({ success: true, role: user.role, courses });
}
