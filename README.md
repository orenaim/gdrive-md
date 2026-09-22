# Headwall MD

An Obsidian-style live-preview editor for Markdown files stored in Google
Drive.

Drive remains the filesystem, the source of truth, the permissions system and
the revision history. This app is a better editing surface for `.md` files
that already live there. It does not manage documents, it does not sync, and
it never creates a file.

```
Drive → right-click a .md file → Open with → Headwall Markdown
```

## The one principle everything else follows from

**The Markdown is canonical.** At every instant, the editor holds a raw
Markdown string that could be written to disk unchanged.

Live Preview is implemented entirely as CodeMirror *decorations* — hiding
markers, styling spans, substituting widgets. No rich-text model exists
anywhere in the codebase, so there is no serialisation step and nothing to
round-trip. This is not a stylistic preference; it is what makes the app safe
to point at files that agents, `git`, Drive Desktop and other editors also
touch. Markdown this app does not understand is left showing its raw source
rather than being normalised or dropped, and a test asserts the document is
byte-identical after rendering at every caret position across a corpus of
awkward syntax.

Source mode is the same CodeMirror document with the decorations switched off.
Switching modes cannot alter the text, because there is no transformation to
run.

## How synchronisation works

Three strings, and one revision id that ties them together:

| | |
|---|---|
| `baseText` | the last content the editor and Drive are known to agree on |
| `baseRevisionId` | Drive's `headRevisionId` for exactly those bytes |
| `localText` | what is in the editor now |
| `remoteText` | Drive's newer content, once an external change is fetched |

- **Autosave** debounces 2s after the last keystroke, with a 5s cap so
  continuous typing still gets persisted. Writes go through `files.update` on
  the same file id.
- **Polling** checks `headRevisionId` every 3s while the tab is visible, backs
  off to 60s when hidden, and checks immediately on return.
- **Preflight** re-checks the revision immediately before every write. If
  Drive has moved on, nothing is uploaded.
- **Merging** is a real three-way merge with `baseText` as BASE. Independent
  edits merge silently; genuine conflicts open a review and nothing is saved
  until every one is decided.

### Two things worth knowing

**A narrow write race remains.** Drive offers no conditional write — there is
no if-match on `files.update`. The preflight closes the gap between polls, but
not the few hundred milliseconds between the preflight response and the upload.
Closing it entirely needs either Drive-side compare-and-swap or the V1
collaboration service owning the write. This is documented at the code that
does it, in `DocumentSession.attemptSave`.

**`node-diff3`'s region grouping is not used.** It groups hunks that merely
*touch*, so a local edit on line 2 and a remote edit on line 3 come back as one
conflict — which is the single most common way two people edit a document.
`src/merge/threeWayMerge.ts` does its own grouping with a strict-overlap test
(two insertions at the same point still conflict, correctly). `node-diff3`
remains the diff engine underneath.

## Architecture

Three layers that do not know about each other:

```
MarkdownEditor (CodeMirror)      no Drive concepts, no network
        ↕
DocumentSession (pure TS)        no React, never calls fetch
        ↕
DriveAdapter (interface)         GoogleDriveAdapter | MockDriveAdapter
```

`DocumentSession` is a reducer plus an orchestrator. Its invariants are stated
in `src/document/sessionTypes.ts` and checked by `assertInvariants` in
development and in every test. The important ones:

- `dirty` is *derived*, never assigned — which is what makes the
  save-in-flight race correct for free. When a save lands, `baseText` becomes
  the text that was uploaded; if the user typed meanwhile, `localText` has
  moved on and the document is still dirty.
- `baseText` and `baseRevisionId` are only ever assigned together.
- A save is never in flight while a remote change is unresolved.

This separation is also the V1 preparation: a Yjs provider slots between the
editor and the session without either being rewritten, and the Drive
revision-detection and merge path survives unchanged, because external edits
made outside Headwall MD will still need it.

```
src/
  auth/        googleAuth.ts            GIS token flow, silent-first
  drive/       DriveAdapter interface, Google + mock implementations,
               openState.ts (validates Drive's launch parameter)
  editor/      MarkdownEditor.tsx, commands.ts
    livePreview/  one module per construct + the rule registry
  document/    DocumentSession, documentReducer, autosave, remotePoller
  merge/       threeWayMerge (pure), MergeReview.tsx, mergeDecorations
  storage/     draftStore.ts (IndexedDB checkpoint)
  ui/          TopBar, SaveStatus, banners
```

## Running it

```bash
npm install
cp .env.example .env.local     # add your Google client ID
npm run dev
```

**Without Google credentials**, open <http://localhost:5173/?mock=1>. That runs
the app against an in-memory Drive with a control surface on
`window.__mockDrive`, so you can simulate another editor:

```js
__mockDrive.setRemoteContent('# Rewritten elsewhere\n')  // triggers the banner
__mockDrive.setCanEdit(false)                            // read-only
__mockDrive.failNextSaves(2)                             // exercise error paths
__mockDrive.setLatency(800)                              // save-in-flight races
```

This is also what the end-to-end suite drives, which is why it needs no
credentials and no network.

## Tests

```bash
npm test                        # 73 unit tests
npx playwright install chromium # once, before the first e2e run
npm run e2e                     # 10 end-to-end scenarios
npm run build                   # type-check + production bundle
```

The unit tests cover the merge matrix (including 700 randomised three-way
merges), every session transition, the launch-parameter validation (including
malformed and hostile `state` values), and the Markdown-canonical invariant. The
end-to-end suite covers the four scenarios that matter: open-and-autosave, an
external change arriving while dirty, a non-conflicting merge, and a conflict
that must be resolved before anything is written.

## Deployment

Served from GitHub Pages at `https://md.headwall.ai` — see
**[docs/deploy-github-pages.md](docs/deploy-github-pages.md)**. A push to
`main` runs the tests and publishes `dist/`.

Note that the Drive "Open with" integration cannot be configured or tested
until the app is live on a real domain: Drive rejects `localhost` as an Open
URL. Everything else is testable locally against `?mock=1`.

## Google setup

See **[docs/google-workspace-setup.md](docs/google-workspace-setup.md)**.

Two scopes, both non-sensitive: `drive.file` (only files the user opens with
this app) and `drive.install` (appear in the "Open with" menu). No restricted
scopes, so an internal Workspace app needs no verification review. There is no
client secret anywhere — the app has no backend that could hold one.

## Deliberately not built

No file browser, no folders, no workspace management, no publishing, no
profiles, no dashboards. Drive already does all of that, and doing it again
here would make this a document manager, which is the thing it is not.

## Attribution

Live Preview was developed with reference to two MIT-licensed projects,
[md-live-preview-editor](https://github.com/t-shoot/md-live-preview-editor) and
[codemirror-rich-obsidian](https://github.com/Type-32/codemirror-rich-obsidian).
See [NOTICE.md](NOTICE.md) for what was taken from each and why.
