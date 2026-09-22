# Deploying Headwall MD to GitHub Pages

The app is a static bundle with no backend and no secrets, so GitHub Pages can
serve it directly. A GitHub Actions workflow builds on every push to `main`
and publishes `dist/`.

Target: **`https://md.headwall.ai`**

This must be working *before* the Drive UI integration can be configured, since
Drive rejects `localhost` as an Open URL. See
[google-workspace-setup.md](./google-workspace-setup.md).

---

## What you give up versus Cloudflare Pages

**GitHub Pages cannot set response headers.** There is no supported mechanism
for it. Concretely, the `public/_headers` file in this repo is Cloudflare
syntax and is ignored here, so the deployed site has:

- no `X-Frame-Options` / `Content-Security-Policy`
- no control over `Cache-Control`

The practical risk is low for this app — it holds no cookies and no session
state, its OAuth token lives only in memory, and Drive opens it in a tab
rather than a frame. But it is a real difference, and it is the reason
[deploy-cloudflare.md](./deploy-cloudflare.md) is still in the repo.

---

## 1. Create the repository

The repo is **public**. Nothing in it is confidential: there is no client
secret, and the OAuth client ID is public by construction because Vite inlines
it into the bundle that every visitor downloads. `.env.local` is gitignored
and never leaves your machine.

```bash
gh repo create <owner>/headwall-md --public --source=. --push
```

If `gh` is not installed: `brew install gh && gh auth login`. Alternatively
create the repo in the browser and:

```bash
git remote add origin https://github.com/<owner>/headwall-md.git
git push -u origin main
```

## 2. Point Pages at Actions

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Not "Deploy from a branch" — this repo builds with a workflow and publishes an
artifact, so there is no `gh-pages` branch to point at.

## 3. Add the build variables

**Settings → Secrets and variables → Actions → Variables** tab →
**New repository variable**, twice:

| Name | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | the client ID from your `.env.local` |
| `VITE_WORKSPACE_DOMAIN` | `headwall.ai` |

**Variables, not secrets.** Both values end up in the shipped JavaScript no
matter what, so storing them as secrets would imply a confidentiality that
does not exist — and would make the build log harder to read for no benefit.

Miss this step and the build still succeeds; the deployed app then fails at
sign-in with "No Google client ID is configured".

## 4. Deploy

Push to `main`, or run the workflow by hand from the **Actions** tab. The
workflow runs the unit tests first and will not publish a failing build.

The first successful run publishes to `https://<owner>.github.io/headwall-md/`.

> **Asset paths will 404 on that URL.** Vite builds with `base: '/'`, which is
> correct for `md.headwall.ai` but wrong for a repository subpath. Do not
> spend time debugging it — attach the custom domain and it resolves itself.
> Only set `base` in `vite.config.ts` if you decide to serve from the
> `github.io` subpath permanently.

## 5. Attach `md.headwall.ai`

`public/CNAME` already contains the domain and is copied into every build, so
the setting survives republishing. Then:

**Settings → Pages → Custom domain** → `md.headwall.ai` → Save.

GitHub will ask DNS to prove the domain points at it. In the **Cloudflare zone
for `headwall.ai`** (Tomer's account), add:

```
Type:   CNAME
Name:   md
Target: <owner>.github.io
Proxy:  DNS only   ← grey cloud, not orange
```

> **The proxy setting matters.** With Cloudflare's orange-cloud proxy enabled,
> GitHub cannot complete the ACME challenge and certificate issuance fails,
> leaving the site on an HTTPS error that looks like a GitHub outage. Leave it
> grey until GitHub reports the certificate as issued. You can turn the proxy
> on afterwards, but only with Cloudflare's SSL mode set to **Full (strict)** —
> with the default mode you get a redirect loop.

Then tick **Enforce HTTPS** in Settings → Pages once it becomes available. It
stays greyed out until the certificate is issued, which usually takes a few
minutes and occasionally up to an hour.

## 6. Register the origin with Google

**Cloud console → APIs & Services → Credentials →** your OAuth client →
**Authorised JavaScript origins**, add:

```
https://md.headwall.ai
```

Exactly that — scheme included, no trailing slash, no path.

Do **not** bother adding the `github.io` origin unless you intend to sign in
there. `?mock=1` covers everything except the Drive hand-off without needing
Google at all.

---

## Verifying

1. `https://md.headwall.ai` loads and shows **"Could not open this file"**.
   That is correct: no Drive `state` parameter was supplied, and the app
   refuses to guess at a file.
2. `https://md.headwall.ai/?mock=1` gives a working editor against the
   in-memory mock. If this works, the bundle is fine and anything still broken
   is Google-side configuration.
3. `curl -sI https://md.headwall.ai | head -n 3` returns `HTTP/2 200`.

Then configure the Drive UI integration (step 5 of the Workspace setup) using
`https://md.headwall.ai` as the Open URL.

## Rolling back

GitHub Pages keeps no deployment history you can promote from. To roll back,
revert the commit and push — the workflow redeploys from `main`:

```bash
git revert <bad-commit> && git push
```
