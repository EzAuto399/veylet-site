# Veylet website

This repository contains the public Veylet website. The deployable files are in [`dist/`](dist/), and [`vercel.json`](vercel.json) selects that directory as the Vercel output. The site source may differ from the version currently served at [veylet.com](https://veylet.com); verify a deployment before describing a change as live.

## Preview locally

From the repository root, run:

```sh
python3 -m http.server 8893 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8893/`. In another terminal, check the local routes and assets:

```sh
bash scripts/health-check.sh http://127.0.0.1:8893
```

Stop the preview server when finished. The health check verifies HTTP responses and a few public-page safeguards. It does not establish real sign-in, tour delivery, payment, device behavior, or customer acceptance.

## Release boundary

Prepare a reviewed selection of public `dist/` files and `vercel.json` for deployment. `node scripts/write-build-info.mjs` updates build metadata and asset references when preparing a release candidate; review those changes before publishing. A Git commit or push is separate from a Vercel deployment. Verify the deployed routes and bytes after release.

Keep client captures, tour packages, credentials, logs, and internal planning out of this public repository and deployment input. Product decisions, strategy history, and release evidence belong in the private product workspace.
