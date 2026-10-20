import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const build = await readFile(new URL('../scripts/build_core.py', import.meta.url), 'utf8');
assert(build.includes("src/'src/platform/libretro/gba-wifi-link.c'"), 'build must patch the browser adapter configuration');
assert(build.includes('GBA_LINK_V2_DEADLINE_CALIBRATION] = 10000;'), 'build must set calibration deadline to 10 s');
assert(build.includes('GBA_LINK_V2_DEADLINE_ACCEPT] = 10000;'), 'build must set accept deadline to 10 s');
assert(build.includes('Advance Wars Online web build: enforce the 10 s WAN calibration window advertised by PROFILE.'), 'build must add a unique, idempotent WAN deadline marker');
assert(build.includes('Could not locate unique GBA Wi-Fi Link callback initialization'), 'build must fail closed if upstream callback layout changes');
assert(build.includes("elif text.count(new)!=1"), 'build must reject unknown or ambiguous upstream source versions');
console.log('WAN calibration deadline build patch smoke test passed.');
