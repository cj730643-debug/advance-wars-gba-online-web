# GitHub + Vercel deployment
Frontend: static WebAssembly application; Relay: persistent Railway Node WebSocket service.

Vercel settings: framework Other, root repository root, build `node scripts/vercel-build.mjs`, install command empty, output `dist`. Do not deploy the long-lived Relay as a Vercel Function.
The tested WASM and full corresponding native source ZIP are committed as release artifacts. Browser code in src is copied into dist during every Vercel build. Native changes require Emscripten rebuild + core/Worker tests + prepare before commit. Build rejects a WASM hash that differs from the recorded smoke test.

After assigning a production domain, append the exact HTTPS origin to the Relay ALLOWED_ORIGINS comma-separated list and wait for Railway SUCCESS. Restrict origins to actual production sites. Preview domains are not enabled automatically.

GitHub connection currently supports existing repository writes but not new repository creation. Once an empty repository with README/main exists and is granted to the connected GitHub app, the prepared source can be uploaded and linked to this Vercel project. Until then, direct-file deployment does not provide automatic GitHub deployment.
