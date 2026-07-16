'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { SessionUser } from './types';

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
}

const SessionContext = createContext<SessionState>({ user: null, loading: true });

/** Fetches the current session once and exposes it to client components. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ user: null, loading: true });

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => {
        if (alive) setState({ user: d?.authenticated ? d.user : null, loading: false });
      })
      .catch(() => {
        if (alive) setState({ user: null, loading: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export function useIsTeacher() {
  const { user } = useContext(SessionContext);
  return user?.role === 'teacher' || user?.role === 'admin';
}
