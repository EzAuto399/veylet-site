# Veylet website

This repository contains the public Veylet website and its local verification tools. The deployable site is in [`dist/`](dist/); [`vercel.json`](vercel.json) selects that directory as the Vercel output. The offer displayed by the site is recorded in [`dist/offer/offer.json`](dist/offer/offer.json). A local checkout can contain work that has not been released to [veylet.com](https://veylet.com), so check a release receipt and the live site before describing a change as available.

## Check a change locally

From the repository root:

```sh
node --test tests/*.test.cjs
python3 scripts/serve-player-check.py --port 8904
# In a second terminal:
bash scripts/health-check.sh http://127.0.0.1:8904
```

Open `http://127.0.0.1:8904/` for the site. See [`tests/README.md`](tests/README.md) for the synthetic account, player, and failure fixtures. Stop the local server when finished.

`node scripts/write-build-info.mjs` updates versioned asset references and `dist/build-info.json`; run it only while preparing a reviewed release candidate, then repeat the tests and local health check. A test pass checks local files and fixtures. It does not prove a hosted payment, email, sign-in, capture, or device journey.

## Release boundary

The site is deployed from a reviewed, frozen selection of public `dist/` files and `vercel.json`. A Git commit or push does not establish that those bytes are live. Before a release, reconcile the public offer and terms with the backend and app, review the exact upload list, and verify the deployed bytes and routes afterward.

Keep client captures, tour packages, credentials, logs, and internal planning out of this repository and deployment input. The site build serves public files from `dist/`; local QA packages are supplied to the fixture server by explicit path and are not copied into `dist/`. Product decisions, strategy history, and release evidence are maintained in the private product workspace.
