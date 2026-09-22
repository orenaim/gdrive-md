import { useEffect, useMemo, useRef, useState } from 'react';
import { DocumentSession, type DocumentSessionOptions } from './DocumentSession';
import type { SessionState } from './sessionTypes';
import type { Draft } from '../storage/draftStore';

export interface SessionBinding {
  session: DocumentSession;
  state: SessionState;
  pendingDraft: Draft | null;
}

/**
 * Binds a `DocumentSession` to React.
 *
 * The session is the source of truth and re-renders are driven by its
 * subscription, not by React state scattered around the tree. That direction
 * matters: it means the sync logic is testable on its own, and it means React
 * cannot get the session into a state the reducer would have rejected.
 */
export function useDocumentSession(options: DocumentSessionOptions | null): SessionBinding | null {
  // Held so the session is created exactly once per set of options, without
  // recreating on every render.
  const sessionRef = useRef<DocumentSession | null>(null);
  const [, forceRender] = useState(0);

  const session = useMemo(() => {
    if (!options) return null;
    const created = new DocumentSession(options);
    sessionRef.current = created;
    return created;
    // The options object is built once by the caller, behind its own memo.
  }, [options]);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = session.subscribe(() => forceRender((n) => n + 1));
    void session.load().then(() => forceRender((n) => n + 1));
    return () => {
      unsubscribe();
      session.dispose();
    };
  }, [session]);

  if (!session) return null;
  return {
    session,
    state: session.getState(),
    pendingDraft: session.getPendingDraft(),
  };
}
