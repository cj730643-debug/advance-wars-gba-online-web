import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [html, css, app] = await Promise.all([
  read('../src/index.html'), read('../src/style.css'), read('../src/app.mjs'),
]);
const controls = [...html.matchAll(/<button\b[^>]*\bdata-key="(\d+)"[^>]*>/g)];
const keys = controls.map(m => Number(m[1])).sort((a, b) => a - b);
assert.deepEqual(keys, [0, 2, 3, 4, 5, 6, 7, 8, 10, 11], 'all ten GBA virtual buttons must be present');
assert.equal(controls.length, new Set(keys).size, 'virtual button key bindings must be unique');
assert(controls.every(m => /\baria-label=/.test(m[0])), 'every virtual button must have an accessible label');
assert(html.includes('鼠标 / 触屏操作'), 'the virtual controller must be clearly labelled');
assert(css.includes('.touch-controls{display:flex;'), 'virtual controls must be visible on desktop, not only mobile');
assert(!css.includes('.touch-controls{display:none}'), 'virtual controls must not be hidden by default');
assert(app.includes('b.onpointerdown=e=>{e.preventDefault();if(!active||paused)return;b.setPointerCapture(e.pointerId);setKeys(keys|(1<<+b.dataset.key));}'), 'mouse and touch must use pointer-down to hold a GBA key');
assert(app.includes("for(const b of document.querySelectorAll('[data-key]'))b.disabled=!active||paused;"), 'virtual controls must be disabled until the game is running and while paused');
assert(app.includes("for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>setKeys(keys&~(1<<+b.dataset.key)));"), 'virtual keys must release on pointer-up/cancel');
console.log('Mouse virtual controller smoke test passed.');
