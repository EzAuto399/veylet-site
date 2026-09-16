# GitHub source backup — 16 September 2026

This branch (`codex/github-backup-2026-09-16`) preserves the local source checkpoint requested by the owner. It is a backup of work in progress, not a tested release or deployment approval. The working checkout, staging area and `main` branch are unchanged.

- Website: https://github.com/EzAuto399/veylet-site (public)
- iPhone app, backend, web interface and pipeline: https://github.com/EzAuto399/property-3d-studio (private)

The snapshot includes tracked files and current new application source, tests, documentation and configuration. The app snapshot includes the Supabase migrations. Ignored credentials, private captures, runtime data, dependencies and generated builds remain local. Newly untracked marketing exports, campaign previews and pricing outputs are outside this application-source backup; existing tracked assets remain included.

The website snapshot disables automatic Vercel deployment only for this backup branch using `git.deploymentEnabled`. Reference: https://vercel.com/docs/project-configuration/git-configuration . Production `main` is not changed.

Backup verification: source paths and Git blob identities were checked; 23 text files were inspected for common credential patterns, and JWT values were classified by role. Public Supabase `anon` configuration is intentionally included; secret/service credentials are not. Python syntax checks covered 0 files; JSON parsing covered 3 files. These checks do not establish native build, application test-suite, installed-device or live-integration success.

Base commit: `97d7bc585a9c93ac4611ed8f5828aab9c44fca15`.

The account JavaScript and public configuration also passed Node syntax checks.
