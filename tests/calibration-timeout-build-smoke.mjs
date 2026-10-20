import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const build = await readFile(new URL('../scripts/build_core.py', import.meta.url), 'utf8');
assert(build.includes("text.find('static bool _absoluteDeadline(')"), 'build must patch the protocol-v2 absolute deadline helper');
assert(build.includes("{'3000000','10000000'}"), 'build must accept only the expected 3 s source or already-patched 10 s source');
assert(build.includes("+'10000000'+"), 'build must extend the protocol-v2 absolute deadline to 10 s');
assert(build.includes("elif text.count(new)!=1"), 'build must reject unknown or ambiguous upstream source versions');
console.log('WAN calibration deadline build patch smoke test passed.');
