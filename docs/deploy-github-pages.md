# Deploying to GitHub Pages

The app is a static bundle with no backend and no secrets, so GitHub Pages can
serve it directly. A GitHub Actions workflow builds on every push to `main`
and publishes `dist/`.

Live at: **`https://orenaim.github.io/gdrive-md/`**

There is no custom domain. Drive only requires that the Open URL be a fully
qualified domain name — `github.io` satisfies that just as well as a domain of
your own, and it removes any dependency on DNS you do not control.

---

## The subpath, and why `base` is relative

Pages serves this repo from `/gdrive-md/`, not from a domain root. With Vite's
default `base: '/'`, `index.html` would request
`https://orenaim.github.io/assets/…` — one level too high — and every asset
would 404 while the HTML itself loaded fine.

`vite.config.ts` therefore sets:

```ts
base: './',
```

Relative rather than a hardcoded `'/gdrive-md/'`, so the same build works at a
domain root, under a renamed repository, or on the dev server. There is no
client-side routing to complicate it. Verify after any build:

```bash
grep -o 'src="[^"]*"' dist/index.html    # expect ./assets/…
```

## What GitHub Pages cannot do

**It cannot set response headers.** No `X-Frame-Options`, no
`Content-Security-Policy`, no `Cache-Control` control. There is no supported
mechanism, which is why this repo ships no `_headers` file — config that
silently does nothing is worse than none.

The practical risk here is low: the app holds no cookies and no session state,
and its OAuth token lives only in memory. But it is a real difference from
Cloudflare Pages, which is why [deploy-cloudflare.md](./deploy-cloudflare.md)
is kept.

---

## 1. Repository

Public, under `orenaim`. Nothing in it is confidential — there is no client
secret, and the OAuth client ID is public by construction because Vite inlines
it into the bundle every visitor downloads. `.env.local` is gitignored.

```bash
git remote add origin git@github.com:orenaim/gdrive-md.git
git push -u origin main
```

## 2. Point Pages at Actions

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Not "Deploy from a branch" — this repo builds with a workflow and uploads an
artifact, so there is no `gh-pages` branch to serve from.

## 3. Build variables

**Settings → Secrets and variables → Actions → Variables** tab →
**New repository variable**, twice:

| Name | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | the client ID from your `.env.local` |
| `VITE_WORKSPACE_DOMAIN` | `headwall.ai`, or empty to allow any Google account |

**Variables, not secrets.** Both end up in the shipped JavaScript regardless,
so marking them secret would imply a confidentiality that does not exist.

Omit these and the build still succeeds — the deployed app then fails at
sign-in with "No Google client ID is configured".

## 4. Deploy

Push to `main`, or run the workflow from the **Actions** tab. It runs the unit
tests first and will not publish a failing build.

---

## Google configuration for this URL

Two fields, and they take **different** forms. This trips people up.

### Authorised JavaScript origin

**Credentials → your OAuth client → Authorised JavaScript origins:**

```
https://orenaim.github.io
```

An origin is scheme + host only. **A path is rejected** — `.../gdrive-md` will
not be accepted here.

> A consequence worth understanding: the origin is the whole of
> `orenaim.github.io`, so any other GitHub Pages site under that account
> shares it and could initiate sign-in with this client ID. With the consent
> screen set to Internal and `drive.file` as the only Drive scope, the blast
> radius is small — a user would still have to consent, and the app could only
> touch files they explicitly opened with it. It is a reason to prefer a domain
> you control if this ever holds anything more sensitive.

### Open URL (Drive UI integration)

**Drive API → Drive UI integration → Open URL:**

```
https://orenaim.github.io/gdrive-md/
```

Here the path *is* required, and the trailing slash matters. Drive appends its
own `?state=…`; do not add a query string yourself.

### Consent screen domains

Leave **App domain**, homepage, privacy-policy and terms-of-service blank for
an Internal app. `github.io` is on the Public Suffix List, so Google may refuse
it as an "authorised domain" — and for an Internal app none of those fields are
required.

---

## Verifying

1. `https://orenaim.github.io/gdrive-md/` loads and shows **"Could not open
   this file"**. That is correct: no Drive `state` parameter was supplied, and
   the app refuses to guess at a file.
2. `https://orenaim.github.io/gdrive-md/?mock=1` gives a working editor against
   the in-memory mock. If this works, the bundle and its asset paths are fine,
   and anything still broken is Google-side configuration.
3. The browser console shows no 404s for `/assets/…` — that would mean `base`
   regressed.

## Rolling back

Pages keeps no promotable deployment history. Revert and push; the workflow
redeploys from `main`:

```bash
git revert <bad-commit> && git push
```
