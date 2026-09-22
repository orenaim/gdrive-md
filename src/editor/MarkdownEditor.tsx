import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EditorView, keymap, drawSelection, rectangularSelection, highlightSpecialChars, dropCursor } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import { livePreview } from './livePreview';
import { codeHighlightStyle, documentTheme, sourceTheme } from './livePreview/theme';
import { insertLink, toggleBold, toggleItalic, toggleStrikethrough } from './commands';
import {
  clearMergeHighlights,
  mergeHighlightField,
  setMergeHighlights,
  type HighlightRange,
} from '../merge/mergeDecorations';

export type EditorMode = 'live' | 'source';

/**
 * The imperative surface the document session uses to talk to the editor.
 *
 * Kept deliberately small. In particular there is no "set Markdown from a
 * rich model" call, because no such model exists: `getText` returns the
 * document verbatim and `setText` replaces it verbatim.
 */
export interface MarkdownEditorHandle {
  getText(): string;
  /** Replaces the whole document (used for merges and remote adoption). */
  setText(text: string, options?: { cursorAt?: number }): void;
  highlight(ranges: HighlightRange[]): void;
  clearHighlight(): void;
  focus(): void;
}

interface Props {
  initialText: string;
  mode: EditorMode;
  readOnly: boolean;
  onChange: (text: string) => void;
  handleRef?: Ref<MarkdownEditorHandle>;
}

/** Marks a transaction as originating from the session, not from the user. */
const programmatic = { userEvent: 'hw.programmatic' } as const;

export function MarkdownEditor({ initialText, mode, readOnly, onChange, handleRef }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const modeCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  // Held in a ref so the effect that builds the view never needs to re-run
  // when the callback identity changes — rebuilding would destroy undo
  // history and scroll position.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          highlightSpecialChars(),
          highlightSelectionMatches(),
          search({ top: true }),
          EditorView.lineWrapping,
          // GFM gives tables, strikethrough and task lists. `codeLanguages`
          // enables highlighting inside fenced blocks by language tag.
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(codeHighlightStyle, { fallback: true }),
          mergeHighlightField,
          modeCompartment.of(mode === 'live' ? livePreview : sourceTheme),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          documentTheme,
          keymap.of([
            { key: 'Mod-b', run: toggleBold, preventDefault: true },
            { key: 'Mod-i', run: toggleItalic, preventDefault: true },
            { key: 'Mod-Shift-x', run: toggleStrikethrough, preventDefault: true },
            { key: 'Mod-k', run: insertLink, preventDefault: true },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            // Every document change reports upward, including programmatic
            // ones. The session distinguishes them by comparing against what
            // it last wrote, which is more robust than trusting an annotation
            // that a composite transaction could lose.
            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Built exactly once. `mode` and `readOnly` are applied through
    // compartments below rather than by rebuilding, because reconfiguring
    // leaves the document, selection and undo history untouched — which is
    // precisely the guarantee Source mode needs to make.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: modeCompartment.reconfigure(mode === 'live' ? livePreview : sourceTheme),
    });
  }, [mode, modeCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly, readOnlyCompartment]);

  useImperativeHandle(
    handleRef,
    (): MarkdownEditorHandle => ({
      getText: () => viewRef.current?.state.doc.toString() ?? '',
      setText: (text, options) => {
        const view = viewRef.current;
        if (!view) return;
        if (view.state.doc.toString() === text) return;
        const anchor = Math.min(
          options?.cursorAt ?? view.state.selection.main.anchor,
          text.length,
        );
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor },
          ...programmatic,
        });
      },
      highlight: (ranges) => {
        viewRef.current?.dispatch({ effects: setMergeHighlights.of(ranges) });
      },
      clearHighlight: () => {
        viewRef.current?.dispatch({ effects: clearMergeHighlights.of(null) });
      },
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  return <div className="hw-editor-host" ref={hostRef} />;
}
