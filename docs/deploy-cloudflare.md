# Deploying Headwall MD to Cloudflare Pages

> **Not the current deployment route.** Production is served from GitHub Pages
> — see [deploy-github-pages.md](./deploy-github-pages.md). This document is
> kept because Cloudflare Pages is a better host for this app in one specific
> respect (it can set response headers, which GitHub Pages cannot), and is
> worth returning to if the `_headers` file ever matters.

The app is a static bundle — no server, no backend, no secrets. Cloudflare
Pages serves it and terminates HTTPS, which is all it needs.

Target: **`https://md.headwall.ai`**

This must be done *before* the Drive UI integration can be configured, because
Drive rejects `localhost` as an Open URL. See
[google-workspace-setup.md](./google-workspace-setup.md).

---

## The one thing to get right

`VITE_*` variables are **inlined at build time**, not read at runtime. The
client ID lives in `.env.local`, which is gitignored and therefore does not
exist on Cloudflare's build machines. If you forget to set the variables in
the Pages project, the build succeeds and the deployed app fails at sign-in
with "No Google client ID is configured".

---

## Route 1 — direct upload with Wrangler (fastest)

No git remote needed, which suits this repo as it stands.

Wrangler is a pinned devDependency, so `npm install` already put it in place —
there is nothing to install globally, and the version is the same for everyone.

Authorise your Cloudflare account (opens a browser):

```bash
npm run cf:login
```

Create the Pages project, once and only once:

```bash
npm run cf:create
```

Then deploy. This builds first, so the `.env.local` values are the ones baked
into the bundle:

```bash
npm run deploy
```

That last command is the whole release process from then on.

Wrangler prints a `https://headwall-md.pages.dev` URL. Confirm the app loads
there before attaching the real domain.

> If you prefer running the tool directly, prefix with `npx`:
> `npx wrangler pages deploy dist --project-name=headwall-md`. A bare
> `wrangler` only works if you have separately installed it globally.

## Route 2 — Git integration (better once the repo has a remote)

Push the repo to GitHub, then in the Cloudflare dashboard:

**Workers & Pages → Create → Pages → Connect to Git**

| Setting | Value |
|---|---|
| Framework preset | None (or Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |

Then **Settings → Variables and Secrets**, and add for **Production**:

```
VITE_GOOGLE_CLIENT_ID = <the client ID from .env.local>
VITE_WORKSPACE_DOMAIN = headwall.ai
```

Neither is a secret — a client ID is an identifier, and both end up visible in
the bundle regardless — so plain variables are correct here, not encrypted
secrets.

The repo pins Node via `.nvmrc` (22). If a build ever fails on an engine
requirement, set `NODE_VERSION` as a build variable to override it.

---

## Attaching `md.headwall.ai`

**Workers & Pages → headwall-md → Custom domains → Set up a custom domain**

Enter `md.headwall.ai`.

- **If `headwall.ai` is already a zone in this Cloudflare account**, Cloudflare
  creates the CNAME itself and issues the certificate. Usually live in under a
  minute.
- **If the domain is hosted elsewhere**, Cloudflare shows a CNAME to add at
  your DNS provider:
  ```
  md.headwall.ai.  CNAME  headwall-md.pages.dev.
  ```
  Certificate issuance then waits on DNS propagation.

Verify before moving on:

```bash
curl -sI https://md.headwall.ai | head -n 3
```

You want `HTTP/2 200`, not a redirect or a 522.

---

## Then: register the origin with Google

The deploy is useless to Drive until Google trusts the origin.

**Cloud console → APIs & Services → Credentials →** your OAuth client →
**Authorised JavaScript origins**, add:

```
https://md.headwall.ai
```

Exactly that — scheme included, no trailing slash, no path.

### About `*.pages.dev`

Cloudflare also serves the app at `https://headwall-md.pages.dev`, and every
preview deployment gets its own `https://<hash>.headwall-md.pages.dev`.

**Sign-in will never work on preview URLs.** Their hostnames are generated per
deployment and cannot be registered as authorised origins in advance. This is
a property of OAuth, not something to work around — preview builds are for
checking layout and rendering, and `?mock=1` covers the rest without any
Google involvement.

You can optionally add the stable `https://headwall-md.pages.dev` as a second
authorised origin if you want a staging URL that can sign in. Leaving it off
is tidier: it means the app only ever authenticates on its real domain.

---

## Routing and caching

There is **no SPA fallback to configure**. The app has no client-side router —
Drive launches it at `/?state=…`, which is the root path with a query string,
and Pages serves `index.html` for `/` by default.

`public/_headers` ships with the build and sets:

- long-lived immutable caching for `/assets/*` (filenames are content-hashed)
- no caching for `index.html`, so a deploy takes effect immediately
- `X-Frame-Options: DENY`, `nosniff`, and a restrictive `Permissions-Policy`

It also contains a **commented-out Content-Security-Policy** tuned for Google
Identity Services and CodeMirror. Enabling it is worthwhile, but do it as its
own deploy and re-test sign-in immediately — a CSP that is marginally too
strict breaks GIS in ways that are unpleasant to debug in production.

---

## Verifying the deployment

1. `https://md.headwall.ai` loads and shows **"Could not open this file"**.
   This is correct: the app was opened without a Drive `state` parameter, and
   it refuses to guess.
2. `https://md.headwall.ai/?mock=1` loads a working editor against the
   in-memory mock. If this works, the bundle is fine and anything still broken
   is Google-side configuration.
3. Open the browser console on the real URL and confirm no CSP or mixed-content
   errors.
4. Now configure the Drive UI integration (step 5 of the Workspace setup),
   using `https://md.headwall.ai` as the Open URL.

## Troubleshooting

### `Authentication error [code: 10000]` on a `/pages/projects/…` request

You are logged in — `wrangler whoami` confirms the email — but the OAuth token
does not carry Pages permissions. Wrangler's login grants a fixed scope set,
and a token minted by an older wrangler, or a consent screen where not every
box was accepted, will be missing `pages:write`.

Check what the token actually has:

```bash
npx wrangler whoami
```

The output ends with a scope table. Look for:

```
pages:write
```

If it is absent, that is the whole problem.

**Fix 1 — re-authorise.** Discard the token and log in again, accepting every
permission on the consent screen:

```bash
npx wrangler logout
npx wrangler login
```

**Fix 2 — use a scoped API token instead.** More reliable, and the right
answer for CI, since it does not depend on an interactive consent screen:

1. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** →
   **Create Custom Token**
2. Permissions: **Account → Cloudflare Pages → Edit**
3. Account Resources: include the account the project belongs to
4. Create, and copy the token — it is shown once

Then:

```bash
export CLOUDFLARE_API_TOKEN=<the token>
export CLOUDFLARE_ACCOUNT_ID=<your account id>
npm run deploy
```

`CLOUDFLARE_API_TOKEN` takes precedence over the stored OAuth credentials, so
there is no need to log out first. It is a real secret — keep it out of the
repo and out of shell history that gets committed anywhere.

The account ID appears in the failing error message itself, and on the right
of any account's dashboard overview page.

### `A project with this name already exists`

`npm run cf:create` is a one-time command. If it has already run — or if the
name is taken elsewhere in the account — skip straight to `npm run deploy`.

### The deploy succeeds but the site 404s

Check that the build actually produced `dist/index.html`. `npm run deploy`
builds first, so a failing `tsc` would stop it before upload; a stale empty
`dist/` from an interrupted run is the usual cause.

## Rolling back

Pages keeps every deployment. **Workers & Pages → headwall-md → Deployments →**
find the last good one → **Manage deployment → Rollback**. It takes effect
immediately, which is the main reason `index.html` is served uncached.
