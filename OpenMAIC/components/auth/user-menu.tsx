'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useSession } from '@/lib/auth/session-context';

/** Shows the signed-in user's name + role and a logout control. */
export function UserMenu() {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-gray-100/50 bg-white/60 px-3 py-1.5 shadow-sm backdrop-blur-md dark:border-gray-700/50 dark:bg-gray-800/60">
      <span className="text-xs text-gray-600 dark:text-gray-300">{user.name}</span>
      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-400">
        {user.role}
      </span>
      <button
        onClick={logout}
        disabled={busy}
        title="Log out"
        className="text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-50 dark:hover:text-gray-200"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
