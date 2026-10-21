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

## Launch day: flip the App Store flag

The App Store download experience for "Veylet Capture" (App Store id 6814273913) is held behind one switch in [`dist/launch-config.js`](dist/launch-config.js). Change exactly this one line:

```js
window.VEYLET_LAUNCH = Object.freeze({ appStoreLive: false });
```

to `appStoreLive: true`. Nothing else is edited. [`dist/launch.js`](dist/launch.js) then reveals every element marked `data-launch="app-store"` (the "Download on the App Store" badge, store links and the Apple trademark credit) and hides every element marked `data-launch="pre-approval"` (the waitlist/TestFlight copy and CTAs). App Store elements ship with the `hidden` attribute, so with the flag off — or with JavaScript off — the site reads exactly as the pre-approval site, and the badge is never shown.

Only flip it to `true` **after** the app is publicly available at <https://apps.apple.com/au/app/id6814273913> (that URL currently returns 404 while the app is in Apple review). Apple's badge licence permits the badge only once the app is live, and the placeholder badge must first be replaced with Apple's official artwork (see the TODO in the home/offer/see markup). Re-run the tests and the release build after flipping. The two flag states are covered by [`tests/launch-flag.test.cjs`](tests/launch-flag.test.cjs).

## Release boundary

The site is deployed from a reviewed, frozen selection of public `dist/` files and `vercel.json`. A Git commit or push does not establish that those bytes are live. Before a release, reconcile the public offer and terms with the backend and app, review the exact upload list, and verify the deployed bytes and routes afterward.

Keep client captures, tour packages, credentials, logs, and internal planning out of this repository and deployment input. The site build serves public files from `dist/`; local QA packages are supplied to the fixture server by explicit path and are not copied into `dist/`. Product decisions, strategy history, and release evidence are maintained in the private product workspace.
