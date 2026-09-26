# Local site and player checks

Run the complete source suite from the repository root:

```sh
node --test tests/*.test.cjs
```

Run one focused file, for example `node --test tests/pricing-clarity.test.cjs`, when changing its behavior. The source tests cover public offer copy, account and studio states, access controls, sharing, the player, app pages, and recovery paths. They use synthetic data and stubs; passing tests do not establish hosted integrations or physical-device behavior.

## Browser fixtures

Start the local fixture server:

```sh
python3 scripts/serve-player-check.py --port 8904
```

Open `http://127.0.0.1:8904/__qa/` for the QA entry page. These routes use fictional accounts and tours:

- `/__qa/account/` and `/__qa/studio/` exercise desk states. Query options such as `?render=waiting`, `?render=recapture`, `?team=owner`, and `?case=correction` select synthetic responses.
- `/__qa/embed/?t=synthetic-fixture-token` and `/__qa/website-guide/` exercise embed loading and copied code on the same loopback origin.
- `/__qa/play/?id=synthetic-tour&format=v2` exercises the streamed player. Add `&graphics=none` to inspect its no-graphics fallback.
- `/__qa/app-account/` exercises the app-facing account page with stubbed responses.

For a retained, approved synthetic export, pass `--package /absolute/path/to/export.zip`. For a streamed package folder, pass `--package-v2 /absolute/path/to/package`; `--gzip` simulates CDN compression for JS, CSS, and JSON. The server serves only the selected fixture files and public site, never the export's parent directory. Stop it after the check.

Confirm a visible first frame, navigation, fallback and console state in the browser. An iframe load event or a fixture test pass alone does not establish that a real tour renders. Use the site README's release boundary before treating any fixture result as deployed or customer proof.
