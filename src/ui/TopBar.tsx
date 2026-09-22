import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../document/sessionTypes';
import type { EditorMode } from '../editor/MarkdownEditor';
import { SaveStatus } from './SaveStatus';

interface Props {
  state: SessionState;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onRetry: () => void;
}

/** Drive's triangle mark, drawn inline so nothing is fetched at runtime. */
function DriveIcon() {
  return (
    <svg width="17" height="15" viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" />
      <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.3c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" />
      <path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}

export function TopBar({ state, mode, onModeChange, onRetry }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  return (
    <div className="hw-topbar">
      <div className="hw-topbar-left">
        {state.webViewLink ? (
          <a
            className="hw-drive-link"
            href={state.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Google Drive"
            aria-label="Open in Google Drive"
          >
            <DriveIcon />
          </a>
        ) : (
          <span className="hw-drive-link" aria-hidden="true">
            <DriveIcon />
          </span>
        )}
        <span className="hw-filename">{state.fileName || 'Untitled'}</span>
      </div>

      <div className="hw-topbar-right">
        <SaveStatus state={state} onRetry={onRetry} />
        <div className="hw-menu" ref={menuRef}>
          <button
            className="hw-btn hw-btn-quiet"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            View
          </button>
          {menuOpen ? (
            <div className="hw-menu-popup" role="menu">
              <button
                className="hw-menu-item"
                role="menuitemradio"
                aria-checked={mode === 'live'}
                onClick={() => {
                  onModeChange('live');
                  setMenuOpen(false);
                }}
              >
                Live preview
                {mode === 'live' ? <span className="hw-menu-check">✓</span> : null}
              </button>
              <button
                className="hw-menu-item"
                role="menuitemradio"
                aria-checked={mode === 'source'}
                onClick={() => {
                  onModeChange('source');
                  setMenuOpen(false);
                }}
              >
                Source mode
                {mode === 'source' ? <span className="hw-menu-check">✓</span> : null}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
