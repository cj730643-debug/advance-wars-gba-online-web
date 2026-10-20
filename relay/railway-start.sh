#!/bin/sh
# Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
# Repository-free deployment of the exact source + npm lockfile on node:22-alpine.
set -eu
umask 077
mkdir -p /tmp/aw-relay
cd /tmp/aw-relay
node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const encoded = process.env.AW_RELAY_BUNDLE;
if (!encoded || encoded.length > 65536) throw Error("INVALID_SOURCE_BUNDLE");
const bytes = Buffer.from(encoded, "base64");
if (crypto.createHash("sha256").update(bytes).digest("hex") !== process.env.AW_RELAY_BUNDLE_SHA256) throw Error("SOURCE_HASH_MISMATCH");
const bundle = JSON.parse(bytes.toString("utf8"));
const names = ["server.mjs", "package.json", "package-lock.json"];
if (Object.keys(bundle).length !== names.length) throw Error("INVALID_SOURCE_FILES");
for (const name of names) {
  if (typeof bundle[name] !== "string") throw Error("INVALID_SOURCE_FILE");
  fs.writeFileSync(name, bundle[name]);
}
'
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
exec node server.mjs
