import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from './config';
import {
  AuthError,
  GoogleAuth,
  consumeRedirectResult,
  fetchDriveUser,
  silentAttemptMade,
  type GoogleUser,
} from './auth/googleAuth';
import { GoogleDriveAdapter } from './drive/googleDriveAdapter';
import { getMockDriveAdapter } from './drive/mockDriveAdapter';
import type { DriveAdapter } from './drive/driveTypes';
import { readOpenStateFromUrl, type DriveOpenState } from './drive/openState';
import { useDocumentSession } from './document/useDocumentSession';
import type { DocumentSessionOptions } from './document/DocumentSession';
import { IndexedDbDraftStore, MemoryDraftStore } from './storage/draftStore';
import { MarkdownEditor, type EditorMode, type MarkdownEditorHandle } from './editor/MarkdownEditor';
import { MergeReview } from './merge/MergeReview';
import { remoteRanges } from './merge/threeWayMerge';
import { TopBar } from './ui/TopBar';
import { DraftRecoveryBanner, MergedBanner, RemoteChangeBanner } from './ui/RemoteChangeBanner';

/** How long merged text stays highlighted before fading out. */
const HIGHLIGHT_MS = 12_000;
/** How long the "merged" confirmation stays up. */
const MERGED_BANNER_MS = 5_000;

type Boot =
  | { phase: 'starting' }
  | { phase: 'bad-launch'; reason: string }
  | { phase: 'needs-signin'; message?: string }
  | { phase: 'wrong-account'; signedInAs: string }
  | { phase: 'ready'; adapter: DriveAdapter; open: DriveOpenState; userId: string };

function CenteredMessage({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="hw-center">
      <h1>{title}</h1>
      {children}
      {action}
    </div>
  );
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'starting' });
  const authRef = useRef<GoogleAuth | null>(null);
  const [mode, setMode] = useState<EditorMode>('live');
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMock = useMemo(
    () => new URL(window.location.href).searchParams.get('mock') === '1',
    [],
  );

  // --- Launch: parse Drive's hand-off, then authenticate ------------------
  /** Identifies the account and moves to READY, or to a blocking screen. */
  const finishAuth = useCallback(
    async (auth: GoogleAuth, open: DriveOpenState, token: string) => {
      try {
        let user: GoogleUser;
        try {
          user = await fetchDriveUser(token);
        } catch {
          // Identity is a safety check, not a requirement. If Drive will not
          // tell us who we are, carry on rather than blocking the edit.
          user = { permissionId: '', emailAddress: '', displayName: '' };
        }

        // The Workspace restriction. `hd` already asked Google for it; this
        // re-check is what makes it actually hold.
        if (
          config.workspaceDomain &&
          user.emailAddress &&
          !user.emailAddress.toLowerCase().endsWith(`@${config.workspaceDomain.toLowerCase()}`)
        ) {
          setBoot({ phase: 'wrong-account', signedInAs: user.emailAddress });
          return;
        }

        // Note what is deliberately *not* checked here: whether
        // `user.permissionId` equals the `userId` Drive put in the Open URL.
        //
        // They are different identifier namespaces. Drive's `state.userId` is
        // an obfuscated profile ID; `about.get` returns a Drive *permission*
        // ID. They coincide for some accounts and not others, so comparing
        // them rejects people who are signed in as exactly the right account.
        //
        // The identity guarantee comes from two places that are actually
        // sound. `hint` (see googleAuth) asks Google to preselect the account
        // Drive named, so the right one is chosen by default. And the
        // `drive.file` grant is per-file and per-account: a file opened by one
        // account simply is not readable by another, so signing in as the
        // wrong identity produces a 404 on load rather than a silent edit
        // under the wrong name. Drive enforces this; we cannot do better by
        // guessing at it.

        setBoot({
          phase: 'ready',
          adapter: new GoogleDriveAdapter(auth),
          open,
          userId: user.permissionId || open.userId || 'unknown',
        });
      } catch (error) {
        setBoot({
          phase: 'needs-signin',
          message: error instanceof AuthError ? error.message : undefined,
        });
      }
    },
    [],
  );

  /** Hands the page over to Google. Does not return. */
  const beginRedirect = useCallback((open: DriveOpenState, interactive: boolean) => {
    const auth = authRef.current ?? new GoogleAuth(open.userId);
    authRef.current = auth;
    try {
      auth.redirectToGoogle({
        interactive,
        driveState: new URL(window.location.href).searchParams.get('state'),
      });
    } catch (error) {
      setBoot({
        phase: 'needs-signin',
        message: error instanceof AuthError ? error.message : undefined,
      });
    }
  }, []);

  useEffect(() => {
    // Must run before anything else reads the URL: it strips the OAuth
    // fragment and puts Drive's `state` back as a query parameter.
    const returned = isMock ? ({ kind: 'none' } as const) : consumeRedirectResult();
    const hasState = new URL(window.location.href).searchParams.has('state');

    // Mock mode still goes through the real launch parsing when a `state` is
    // supplied, so the end-to-end suite exercises the actual Drive hand-off
    // path rather than a shortcut around it.
    if (isMock) {
      if (hasState) {
        const parsed = readOpenStateFromUrl(window.location.href);
        if (!parsed.ok) {
          setBoot({ phase: 'bad-launch', reason: parsed.reason });
          return;
        }
        setBoot({
          phase: 'ready',
          adapter: getMockDriveAdapter(),
          open: parsed.state,
          userId: parsed.state.userId ?? 'mock-user',
        });
        return;
      }
      setBoot({
        phase: 'ready',
        adapter: getMockDriveAdapter(),
        open: { fileId: 'mock-file-id-0000000001' },
        userId: 'mock-user',
      });
      return;
    }

    const parsed = readOpenStateFromUrl(window.location.href);
    if (!parsed.ok) {
      setBoot({ phase: 'bad-launch', reason: parsed.reason });
      return;
    }
    const open = parsed.state;

    // Coming back from Google with a token: the common case, and the one the
    // whole redirect flow exists to make invisible.
    if (returned.kind === 'token') {
      const auth = new GoogleAuth(open.userId);
      auth.setToken(returned.accessToken, returned.expiresAt);
      authRef.current = auth;
      void finishAuth(auth, open, returned.accessToken);
      return;
    }

    // Google refused to proceed without the user. Ask, rather than bouncing
    // them through a redirect that will refuse again.
    if (returned.kind === 'error') {
      setBoot({
        phase: 'needs-signin',
        ...(returned.needsInteraction ? {} : { message: returned.error }),
      });
      return;
    }

    // A fresh launch. Try silently — a signed-in user with an existing grant
    // never sees Google at all. The attempt is recorded so that a silent
    // refusal cannot put us in a redirect loop.
    if (!silentAttemptMade()) {
      beginRedirect(open, false);
      return;
    }
    setBoot({ phase: 'needs-signin' });
  }, [isMock, finishAuth, beginRedirect]);

  // --- The document session ----------------------------------------------
  const sessionOptions = useMemo<DocumentSessionOptions | null>(() => {
    if (boot.phase !== 'ready') return null;
    return {
      adapter: boot.adapter,
      fileId: boot.open.fileId,
      ...(boot.open.resourceKey ? { resourceKey: boot.open.resourceKey } : {}),
      userId: boot.userId,
      draftStore:
        typeof indexedDB === 'undefined' ? new MemoryDraftStore() : new IndexedDbDraftStore(),
      autosaveDebounceMs: config.autosaveDebounceMs,
      autosaveMaxIntervalMs: config.autosaveMaxIntervalMs,
      pollActiveMs: config.pollActiveMs,
      pollHiddenMs: config.pollHiddenMs,
    };
  }, [boot]);

  const binding = useDocumentSession(sessionOptions);

  // --- Merge plumbing ------------------------------------------------------
  const highlightRemote = useCallback((before: string, merged: string) => {
    const ranges = remoteRanges(before, merged);
    if (ranges.length === 0) return;
    editorRef.current?.highlight(ranges);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => {
      editorRef.current?.clearHighlight();
    }, HIGHLIGHT_MS);
  }, []);

  const handleMerge = useCallback(() => {
    if (!binding) return;
    const before = binding.session.getState().localText;
    const result = binding.session.mergeUpdate();
    if (!result.conflicts) {
      // The session has already committed the merge; the editor now has to be
      // told, since it is not driven from session state on every keystroke.
      editorRef.current?.setText(result.merged);
      highlightRemote(before, result.merged);
    }
  }, [binding, highlightRemote]);

  const handleResolve = useCallback(
    (mergedText: string) => {
      if (!binding) return;
      const before = binding.session.getState().localText;
      binding.session.applyMerge(mergedText);
      editorRef.current?.setText(mergedText);
      highlightRemote(before, mergedText);
    },
    [binding, highlightRemote],
  );

  const handleRecoverDraft = useCallback(() => {
    if (!binding) return;
    const draft = binding.pendingDraft;
    if (!draft) return;
    binding.session.recoverDraft();
    editorRef.current?.setText(draft.localText);
  }, [binding]);

  // The merge confirmation is transient by design: it acknowledges what
  // happened and then stops taking up space.
  const mergedAt = binding?.state.mergedAt ?? null;
  useEffect(() => {
    if (mergedAt === null || !binding) return;
    const timer = setTimeout(() => binding.session.clearMergedFlag(), MERGED_BANNER_MS);
    return () => clearTimeout(timer);
  }, [mergedAt, binding]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  // --- Pre-document screens ------------------------------------------------
  if (boot.phase === 'starting') {
    return (
      <div className="hw-app">
        <CenteredMessage title="Opening…" />
      </div>
    );
  }

  if (boot.phase === 'bad-launch') {
    return (
      <div className="hw-app">
        <CenteredMessage title="Could not open this file">
          <p>{boot.reason}</p>
          <p>
            Headwall MD opens a Markdown file straight from Google Drive. In Drive, right-click a
            <code> .md </code> file and choose <strong>Open with → Headwall Markdown</strong>.
          </p>
        </CenteredMessage>
      </div>
    );
  }

  if (boot.phase === 'needs-signin') {
    const parsed = readOpenStateFromUrl(window.location.href);
    return (
      <div className="hw-app">
        <CenteredMessage
          title="Sign in to open this file"
          action={
            <button
              className="hw-btn hw-btn-primary"
              onClick={() => parsed.ok && beginRedirect(parsed.state, true)}
            >
              Continue with Google
            </button>
          }
        >
          <p>
            Headwall MD needs permission to read and write this one Drive file. It cannot see
            anything else in your Drive.
          </p>
          {boot.message ? <pre>{boot.message}</pre> : null}
        </CenteredMessage>
      </div>
    );
  }

  if (boot.phase === 'wrong-account') {
    const parsed = readOpenStateFromUrl(window.location.href);
    return (
      <div className="hw-app">
        <CenteredMessage
          title="Wrong Google account"
          action={
            <button
              className="hw-btn hw-btn-primary"
              onClick={() => parsed.ok && beginRedirect(parsed.state, true)}
            >
              Switch account
            </button>
          }
        >
          <p>
            You are signed in as <strong>{boot.signedInAs}</strong>, which is not
            a {config.workspaceDomain} account. Headwall MD is configured for the{' '}
            {config.workspaceDomain} workspace.
          </p>
        </CenteredMessage>
      </div>
    );
  }

  if (!binding) {
    return (
      <div className="hw-app">
        <CenteredMessage title="Opening…" />
      </div>
    );
  }

  const { session, state, pendingDraft } = binding;

  if (state.status === 'ERROR') {
    return (
      <div className="hw-app">
        <TopBar state={state} mode={mode} onModeChange={setMode} onRetry={() => void session.saveNow()} />
        <CenteredMessage title="Could not open this file">
          <p>{state.error?.message}</p>
        </CenteredMessage>
      </div>
    );
  }

  if (state.status === 'LOADING') {
    return (
      <div className="hw-app">
        <TopBar state={state} mode={mode} onModeChange={setMode} onRetry={() => {}} />
        <CenteredMessage title="Loading…" />
      </div>
    );
  }

  return (
    <div className="hw-app">
      <TopBar
        state={state}
        mode={mode}
        onModeChange={setMode}
        onRetry={() => void session.saveNow()}
      />

      {pendingDraft ? (
        <DraftRecoveryBanner
          savedAt={pendingDraft.savedAt}
          onRecover={handleRecoverDraft}
          onDiscard={() => session.discardDraft()}
        />
      ) : null}

      <RemoteChangeBanner state={state} onMerge={handleMerge} />

      {state.mergedAt !== null ? (
        <MergedBanner onDismiss={() => session.clearMergedFlag()} />
      ) : null}

      {state.error?.needsReauth ? (
        <div className="hw-banner hw-banner-error" role="alert">
          <span className="hw-banner-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="hw-banner-text">
            Your Google session expired, so saving is paused.
            <span className="hw-banner-detail">
              Your edits are checkpointed in this browser and will be offered back when you
              return.
            </span>
          </span>
          <button
            className="hw-btn hw-btn-primary"
            onClick={() => beginRedirect(boot.open, true)}
          >
            Reconnect
          </button>
        </div>
      ) : state.error && !state.error.retryable ? (
        <div className="hw-banner hw-banner-error" role="alert">
          <span className="hw-banner-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="hw-banner-text">{state.error.message}</span>
        </div>
      ) : null}

      <MarkdownEditor
        initialText={state.baseText}
        mode={mode}
        readOnly={state.readOnly}
        onChange={(text) => session.edit(text)}
        handleRef={editorRef}
      />

      {state.status === 'MERGING' && state.mergeAnalysis ? (
        <MergeReview
          analysis={state.mergeAnalysis}
          onCancel={() => session.cancelMergeReview()}
          onResolve={handleResolve}
        />
      ) : null}
    </div>
  );
}
