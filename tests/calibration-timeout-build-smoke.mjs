import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const build = await readFile(new URL('../scripts/build_core.py', import.meta.url), 'utf8');
assert(build.includes("old='const uint64_t duration = UINT64_C(3000000);'"), 'build must identify the pinned upstream 3 s deadline');
assert(build.includes("new='const uint64_t duration = UINT64_C(10000000);'"), 'build must extend the protocol-v2 absolute deadline to 10 s');
assert(build.includes("elif text.count(new)!=1"), 'build must reject unknown or ambiguous upstream source versions');
console.log('WAN calibration deadline build patch smoke test passed.');
