import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const build = await readFile(new URL('../scripts/build_core.py', import.meta.url), 'utf8');
assert(build.includes("src/'src/platform/libretro/gba-wifi-link.c'"), 'build must patch the browser adapter configuration');
assert(build.includes('GBA_LINK_V2_DEADLINE_CALIBRATION] = 10000;'), 'build must set calibration deadline to 10 s');
assert(build.includes('GBA_LINK_V2_DEADLINE_ACCEPT] = 10000;'), 'build must set accept deadline to 10 s');
assert(build.includes('Partially applied or ambiguous WAN deadline configuration'), 'build must reject partial or duplicate patching');
assert(build.includes("elif text.count(new)!=1"), 'build must reject unknown or ambiguous upstream source versions');
console.log('WAN calibration deadline build patch smoke test passed.');
