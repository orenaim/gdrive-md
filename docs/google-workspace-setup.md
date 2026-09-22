# Configuring Google Cloud and Workspace for Headwall MD

This sets up "Open with → Headwall Markdown" in Google Drive for the Headwall
Workspace domain. It is a one-time task, done by someone with both **Google
Cloud project owner** and **Workspace super admin** access.

Budget about 30 minutes. The Drive UI integration is the fiddly part; the rest
is standard.

---

## What we are asking Google for, and why it is small

Headwall MD requests exactly two OAuth scopes, both of which Google classifies
as **non-sensitive**:

| Scope | What it grants |
|---|---|
| `https://www.googleapis.com/auth/drive.file` | Read and write **only** the files the user explicitly opens with this app (through "Open with" or the Picker). Nothing else in Drive is visible to it. |
| `https://www.googleapis.com/auth/drive.install` | Lets the app appear in Drive's "Open with" menu. |

This matters for two reasons:

- **No verification review.** Non-sensitive scopes on an internal app do not
  require Google's OAuth verification process, so there is nothing to submit
  and nothing to wait for.
- **Per-file access is the real security boundary.** Even though this is an
  internal app, it genuinely cannot enumerate or read the rest of anyone's
  Drive. The user grants access one file at a time, by opening it.

We deliberately do **not** request `drive` or `drive.readonly`. Those are
restricted scopes, require annual third-party security assessment, and would
give the app far more access than it needs.

---

## 1. Google Cloud project

1. Go to <https://console.cloud.google.com/> and create a project — for
   example **Headwall MD**. Put it in the Headwall organisation so it inherits
   organisation policy.
2. Note the project ID; you will need it below.

## 2. Enable the APIs

**APIs & Services → Library**, then enable:

- **Google Drive API** — the file read/write calls.
- **Google Picker API** — not used by V0, but enabling it now avoids a second
  configuration pass if a file picker is ever added.

## 3. OAuth consent screen

**APIs & Services → OAuth consent screen**

1. **User type: Internal.** This is the important one. Internal restricts the
   app to accounts in the Headwall Workspace domain and removes the
   verification requirement entirely.
2. App name: `Headwall Markdown`
3. User support email: a monitored Headwall address.
4. App domain / home page: `https://md.headwall.ai`
5. Authorised domain: `headwall.ai`
6. Developer contact: a monitored Headwall address.
7. **Scopes** — add exactly:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive.install`

   If `drive.install` is not offered in the picker, paste it into the
   "Manually add scopes" box.

## 4. OAuth client ID

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Web application**
- Name: `Headwall MD web`
- **Authorised JavaScript origins** — these must match exactly, including
  scheme and port. No trailing slash.
  - `https://md.headwall.ai`
  - `http://localhost:5173` (development)
- **Authorised redirect URIs** — leave empty. The app uses the Google Identity
  Services token flow, which does not redirect.

Copy the generated **Client ID** into `.env.local` (or your deployment's
environment) as `VITE_GOOGLE_CLIENT_ID`.

There is a client secret on this screen. **Ignore it.** A browser app cannot
keep a secret, this app does not use one, and pasting it into a `VITE_*`
variable would publish it in the bundle.

## 5. Drive UI integration — the "Open with" entry

> **Deploy first.** This step needs a live HTTPS domain (see step 8); Drive
> rejects `localhost` as an Open URL. If the app is not deployed yet, do step 8
> before this one.

**APIs & Services → Google Drive API → Drive UI Integration**
(direct link: <https://console.cloud.google.com/apis/api/drive.googleapis.com/drive-ui-integration>)

### Application name and icons

- Application name: `Headwall Markdown` — this is the text that appears in the
  "Open with" menu.
- Upload three PNG icons: 16×16, 32×32 and 128×128.

### Open URL

```
https://md.headwall.ai
```

> **The Open URL must be a fully qualified domain name. `localhost` is
> rejected.** This is the practical blocker for testing: the Drive "Open with"
> integration cannot be exercised at all until the app is deployed somewhere
> publicly reachable over HTTPS. Local development against `?mock=1` covers
> everything except the Drive hand-off itself.

Drive appends its own `state` query parameter when launching; do not add one
yourself and do not add a path. The app reads `state` from the query string
and validates it (`src/drive/openState.ts`).

### Default MIME types

```
text/markdown
text/x-markdown
```

### Default file extensions

```
md
markdown
```

### Secondary MIME types and extensions

Drive files created by other tools are very often stored as `text/plain` even
when the name ends in `.md`, so add:

- Secondary MIME types: `text/plain`
- Secondary file extensions: `md`, `markdown`, `mdown`, `mkd`

> The app itself re-checks this on open (`isSupportedMarkdownFile` in
> `src/drive/googleDriveAdapter.ts`) and accepts `text/plain` only when the
> filename confirms it is Markdown. Registering `text/plain` here means
> Headwall MD is *offered* for every plain-text file; the app then declines
> anything that is not Markdown rather than risking corruption.

### Checkboxes

- **Importing** — leave **off**. Importing is how an app offers to convert a
  file into its own format, which is exactly what this product must never do.
- **Multiple file selection** — leave **off**. V0 opens one file.

## 6. Making the app available to users

There are two routes, and they are genuinely different. The first is enough to
start using the app; the second is a convenience that costs noticeably more
setup.

### Route A — per-user, via the consent screen (no Marketplace)

**Publishing to the Google Workspace Marketplace is not required for "Open
with" to work.** The Drive UI integration from step 5 plus the `drive.install`
scope is what registers the app: when a user opens Headwall MD and grants
consent, Drive adds "Headwall Markdown" to the **Open with** menu for that
user, for the file types registered in step 5.

So once the app is deployed at its real domain and step 5 is filled in, there
is nothing further to do. Each person sees the consent screen once.

This is the recommended route for V0 and for piloting.

### Route B — domain-wide install (requires a private Marketplace listing)

This is what the **Apps → Google Workspace Marketplace apps** screen in the
admin console lists. That screen shows only apps that have been *published to
the Marketplace*, which is why Headwall MD does not appear there and why there
is no "Add app" button — the modern UI offers **Install app**, which searches
the public Marketplace.

To get it there, publish it as a **private** app:

1. In the Cloud console, **APIs & Services → Library**, enable the
   **Google Workspace Marketplace SDK** (this is a *different* SDK from the
   Drive API enabled in step 2).
2. Open the Marketplace SDK → **App Configuration**:
   - **App visibility: Private** — restricted to the Headwall organisation.
   - **Installation settings:** admin-only install, or allow individual users.
   - Tick the **Drive extension** integration and supply the same Open URL and
     MIME types as step 5.
3. Fill in the **Store Listing**. A complete listing is mandatory even for a
   private app: name, detailed description, application icons, at least one
   screenshot, a terms-of-service URL, a privacy-policy URL and a support URL.
   The listing's URLs must be on a domain you have verified ownership of in
   Search Console.
4. **Publish.** Private apps skip Google's review entirely and go live for the
   organisation immediately.
5. The app now appears under **Internal apps**
   (<https://workspace.google.com/marketplace/mydomainapps>) and in the admin
   console screen above, where it can be installed for everyone or scoped to
   an OU.

Domain-wide install also pre-grants the two OAuth scopes, so users never see a
consent screen.

> **App visibility is permanent.** Once a Marketplace listing is published as
> public or private, that choice cannot be changed afterwards. Choose
> **Private**.

> Note that domain-wide install removes the *consent screen*, but not the
> one-click sign-in described under Troubleshooting — that is caused by the
> browser's popup blocker, not by consent.

## 7. Making Headwall MD the default handler for `.md`

Google does not offer a true "default application" setting for a MIME type.
What is available:

- **Per user:** in Drive, right-click a `.md` file → **Open with → Manage
  apps**, and tick **Use by default** next to Headwall Markdown. Drive then
  uses it for double-click on `.md` files for that user.
- **Domain-wide:** there is no admin setting that forces a default handler.
  The closest is a domain-wide install (step 6, route B) so the app is always
  present in the menu, and telling people about the per-user toggle.

If no other app claims `.md`, Drive will usually pick Headwall Markdown on
double-click anyway, because it is the only registered handler.

## 8. Deploying

**See [deploy-github-pages.md](./deploy-github-pages.md)** for the full
walkthrough, including attaching `md.headwall.ai` and the Cloudflare
proxy setting that breaks certificate issuance.
([deploy-cloudflare.md](./deploy-cloudflare.md) documents the alternative.)

The app is a static bundle — no server, no backend.

```bash
npm ci
npm run build          # emits dist/
```

Serve `dist/` from any static host at `https://md.headwall.ai`, with:

- **HTTPS required.** Google Identity Services refuses to run over plain HTTP
  on a non-localhost origin.
- **SPA fallback.** Drive launches the app at `/?state=…`, so a plain static
  host works, but make sure unknown paths fall back to `index.html` rather
  than 404ing.
- The origin must exactly match an Authorised JavaScript origin from step 4.

Set `VITE_GOOGLE_CLIENT_ID` and `VITE_WORKSPACE_DOMAIN` in the build
environment. They are baked in at build time, so a change to either needs a
rebuild.

---

## Verifying the setup

1. In Drive, put a `.md` file in a **Shared Drive** (this is the case most
   likely to be misconfigured, because it needs `supportsAllDrives=true` on
   every call — the app does this, but Shared Drive permissions are separate).
2. Right-click → **Open with → Headwall Markdown**.
3. The document should open in Live Preview with "Saved to Drive ✓".
4. Type something, wait two seconds, and confirm the status goes
   **Editing… → Saving… → Saved to Drive ✓**.
5. Open the same file in another editor, change a line, and save. Within a few
   seconds Headwall MD should show **"This file was updated elsewhere"**.
6. Check Drive's file list: there must still be exactly **one** file. If a
   second one appeared, something is badly wrong — please file a bug, as the
   app has no code path that creates files.

## Troubleshooting

**"Sign in to open this file" on every open.**

Expected in V0, and worth understanding before treating it as a bug.

Google Identity Services implements the OAuth *token* flow with a popup
window. There is no hidden-iframe variant, unlike the older `gapi` client.
Setting `prompt: ''` removes the consent *screen* for a client that already
holds a grant, but it does not remove the popup. Drive launches this app into
a fresh tab, and that new document carries no user activation of its own — the
click happened on the Drive page, and transient activation does not cross
documents — so the browser blocks the popup.

The app handles this deliberately: it attempts the token request on load, and
when the popup is blocked it shows the sign-in screen. The button press then
supplies the activation the popup needs. So the cost is **one click per
launch**, not a failure. Token refreshes later in the session happen while the
user is actively editing, where the popup opens and closes unnoticed.

Installing the app domain-wide (step 6) removes the consent screen but *not*
this click, because the obstacle is the popup blocker rather than consent.

To make the first open seamless, the app would have to use the **redirect
flow** instead: navigate the top-level window to Google's authorisation
endpoint and let it redirect back with the token in the URL fragment. No popup
means no activation requirement. That needs Drive's `state` parameter to be
preserved across the redirect (in `sessionStorage`) and a fragment-parsing
step on return, and it adds a full page navigation to every launch. It was not
built for V0.

**Other causes of a sign-in loop**, if the click itself does not work:
the origin does not exactly match an Authorised JavaScript origin (check
scheme, port, no trailing slash), or third-party cookies are blocked for
`accounts.google.com`.

**The "Continue with Google" button itself does nothing.**
The popup is being blocked even with a user gesture, which usually means the
browser is set to block all popups for the site, or the origin does not match
an Authorised JavaScript origin from step 4.

**"Wrong Google account".**
Drive told the app which account opened the file and a different one is signed
in here. Click **Switch account**. This is a deliberate guard — see
`src/App.tsx` — because editing as the wrong identity misattributes changes in
Drive's revision history.

**403 on save for a Shared Drive file.**
The user has Viewer or Commenter on the Shared Drive. Drive's own permissions
apply; the app cannot and should not work around them. The UI shows
**View only** in this case.

**The app does not appear in "Open with".**
Most likely the Drive UI integration (step 5) is incomplete — it needs an Open
URL on a real domain and at least one MIME type — or the signed-in user has
not yet granted consent, which is what actually registers the app for them
(step 6, route A). Note that a Marketplace listing is *not* required for this.

**The app is missing from Apps → Google Workspace Marketplace apps in the
admin console.**
That screen lists only published Marketplace apps, and its "Install app"
button searches the public Marketplace. An app that has not been published
will never appear there. Either use route A in step 6, which does not involve
the Marketplace at all, or publish a private listing via the Google Workspace
Marketplace SDK as described in route B.
