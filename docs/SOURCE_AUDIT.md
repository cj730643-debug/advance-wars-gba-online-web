# Browser source audit · 2026-10-20
Upstream: Aelvryx/mgba-wifi-link commit 9e919b0cfbb93af7d1171570dfc6745d00eeebab, MPL-2.0. Recovered complete modified source from previously delivered Diagnostic-alpha3 source archive, SHA-256 802808c01b38de8a1c438ee74b12bb45ff7f7c1d1208d9b3c5849960052d19c8 for enclosing diagnostic ZIP. Recovery source has no .git metadata. Compiler reports the upstream core version from retained source; compatibility on Relay uses actual WASM SHA-256.

Inspected actual CMake configuration and libretro callbacks, gba-wifi-link.c, session-v2.c, protocol-v2.h, transport.c, replicated-pair.c, client/bridge.hpp and Relay protocol/tests. Original detailed Windows audit accompanies this file.

Real mgba_libretro CMake target can be linked into a single Worker WASM executable. Upstream converts shared library requests under Emscripten into static archives. Qt/SDL, external codecs and other optional frontends are disabled. POSIX declarations supplied through _POSIX_C_SOURCE and _GNU_SOURCE. HAVE_PTHREAD_H explicitly FALSE because upstream otherwise re-enables pthreads even when USE_PTHREADS=OFF. No SharedArrayBuffer/COOP/COEP dependency. Emscripten 3.1.74 Asyncify permits the host receive-poll callback to yield while WebSocket events deliver packets. No serial/CPU/input-delay/state-check changes in the browser port.

The actual Netpacket API requires reliable sequenced two-player callbacks and synchronous receive polling on the emulation thread. Browser frontend owns HTTP room admission, WebSocket heartbeat and copied inbound queues. Bridge alone invokes core callbacks on the Worker stack. The public Relay authenticates roles and opaque transport envelopes and never interprets emulated state. Manifest includes actual ROM SHA-256, actual WASM SHA-256 and fixed profile digest. Window native and browser builds deliberately fail compatibility checks against each other.

Saving: core battery buffers are copied only after retro_run returns; network battery export occurs only after stop restores the local logical machine checkpoint. Solo/p0/p1 and each ROM hash use separate IndexedDB keys. IndexedDB/physical audio/UI need real-browser verification; Node assertions cover core battery import/export and paused Worker export.

Build: use scripts/build_core.py per README. Full vendor corresponding source is supplied in dist/source.zip; after a fresh Git checkout, extract vendor from that archive first. Do not clone unpinned upstream HEAD and assume equivalent behavior.

Both commercial games remain unverified without user-provided legal ROMs. No commercial bytes were supplied, downloaded, uploaded or included. Multi-Pak menu flow must be validated independently for each title; no claim of two-console or full-match certification.
