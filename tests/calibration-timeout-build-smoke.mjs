import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const build = await readFile(new URL('../scripts/build_core.py', import.meta.url), 'utf8');
assert(build.includes("src/'src/platform/libretro/gba-wifi-link.c'"), 'build must patch the browser adapter configuration');
assert(build.includes('GBA_LINK_V2_DEADLINE_CALIBRATION] = 10000;'), 'build must set calibration deadline to 10 s');
assert(build.includes('GBA_LINK_V2_DEADLINE_ACCEPT] = 10000;'), 'build must set accept deadline to 10 s');
assert(build.includes('Advance Wars Online web build: enforce the 10 s WAN calibration window advertised by PROFILE.'), 'build must add a unique, idempotent WAN deadline marker');
assert(build.includes('Could not locate unique GBA Wi-Fi Link callback initialization'), 'build must fail closed if upstream callback layout changes');
assert(build.includes('Partially applied or ambiguous WAN deadline configuration'), 'build must reject partial or duplicate patching');
assert(build.includes('GBA_LINK_CALIBRATION_MAX_SAMPLE_US 10000000'), 'build must tolerate a delayed background-tab calibration sample');
assert(build.includes('GBA_LINK_CALIBRATION_POLICY_VERSION 2'), 'build must prevent mixed old/new calibration policies');
assert(build.includes("text.find('static bool _absoluteDeadline(')"), 'build must scope the deadline patch to its helper');
assert(build.includes("body.count(old_duration)==1"), 'build must patch the original absolute deadline once');
assert(build.includes('const uint64_t duration = UINT64_C(10000000);'), 'build must extend the absolute calibration/accept deadline to 10 s');
assert(build.includes("raise SystemExit('Unexpected source version while patching '+label)"), 'build must fail closed on unexpected upstream source');
console.log('WAN calibration deadline and background-tab tolerance smoke test passed.');
