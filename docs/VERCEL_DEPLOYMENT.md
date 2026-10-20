# GitHub + Vercel deployment
Production: https://advance-wars-gba-online.vercel.app/
GitHub: https://github.com/cj730643-debug/advance-wars-gba-online-web
Vercel project: advance-wars-gba-online (prj_ontIiIZHwAaJKufa0L12YDvDpARE).
Git integration: cj730643-debug/advance-wars-gba-online-web, production branch main.

Framework Other; repository root; build node scripts/vercel-build.mjs; empty install command; output dist. Every main push automatically triggers a Vercel production build.
WSS Relay remains on Railway at https://aw-relay-production.up.railway.app. Its ALLOWED_ORIGINS includes the exact production origin and retained Sites origin; preview origins are not enabled.
Canonical production alias is public. Preview and unique deployment URLs retain Vercel Authentication under prod_deployment_urls_and_all_previews.

The tested WASM and split corresponding native source archive are committed. vercel-build reassembles dist/source.zip with SHA-256 validation and copies current src files. Native changes require Emscripten rebuild, tests, scripts/prepare.py then scripts/split-source.mjs before commit.
.env files, .vercel credentials/runtime state and logs are excluded from source packaging and Git. Never commit device login credentials or Vercel OIDC tokens.

Verification: public HTTP/JS/WASM loading and actual remote Chrome local-ROM startup, paused battery export, IndexedDB battery persistence after reload, and browser-host/Node-peer WSS state checks passed with CC0 diagnostic ROM. Commercial game and two Windows browser acceptance remain unverified.
