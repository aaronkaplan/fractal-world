"use strict";
const results = [];
function test(name, callback) {
  try { callback(); results.push(`PASS: ${name}`); }
  catch (error) { results.push(`FAIL: ${name}: ${error.message}`); }
}
function assert(condition, message) { if (!condition) throw new Error(message); }
test('Known interior points remain in the set', () => {
  const unit = 1n << 128n;
  for (const x of [0n, -unit, -unit / 2n]) assert(preciseEscape(x, 0n, 128, 1000) === -1, 'Interior escaped');
});
test('Known exterior point escapes with expected smooth count', () => {
  const unit = 1n << 128n;
  const result = preciseEscape(2n * unit, 0n, 128, 1000);
  // Orbit: 0 → 2 → 6 → 38; bailout is |z| > 16.
  const expected = 3 - Math.log2(Math.log2(38));
  assert(Math.abs(result - expected) < 1e-9, `Unexpected escape: ${result}`);
});
test('Zoom passes the former 20,000× limit', () => {
  const view = new PrecisionView();
  view.zoom(Math.log(1e12), { x: 320, y: 240 }, 640, 480);
  assert(view.logZoom > 39 && view.spanAt() > 0n, 'Zoom stopped');
});
test('Zoom beyond floating-point underflow retains distinct pixels', () => {
  const view = new PrecisionView();
  view.zoom(400 * Math.LN10, { x: 320, y: 240 }, 640, 480);
  assert(view.bits > 1300, 'Precision did not grow');
  assert(view.spanAt() / 2160n > 0n, 'Adjacent 4K pixels collapsed');
  assert(!view.label().includes('Infinity'), 'Zoom label overflowed');
  const before = view.x;
  view.zoom(0.1, { x: 960, y: 540 }, 3840, 2160);
  assert(view.x !== before, 'Deep cursor targeting lost precision');
});
test('Zoom toward cursor keeps the targeted coordinate fixed', () => {
  const view = new PrecisionView();
  const target = view.x + view.spanAt() / 4n;
  view.zoom(Math.log(2), { x: 440, y: 240 }, 640, 480);
  const after = view.x + view.spanAt() / 4n;
  assert(target === after, 'Target moved');
});
test('Centered zoom in/out restores center and scale', () => {
  const view = new PrecisionView();
  const original = view.number(view.x);
  view.zoom(1000, { x: 320, y: 240 }, 640, 480);
  view.zoom(-1000, { x: 320, y: 240 }, 640, 480);
  assert(Math.abs(view.logZoom) < 1e-10, 'Scale did not restore');
  assert(view.number(view.x) === original, 'Center changed');
});
test('Deep exterior and boundary fixtures remain distinguishable', () => {
  const bits = 1500;
  const unit = 1n << BigInt(bits);
  assert(preciseEscape(-2n * unit, 0n, bits, 1500) === -1, 'Boundary -2 escaped');
  assert(preciseEscape(-2n * unit - (1n << 180n), 0n, bits, 1500) > 0, 'Deep exterior collapsed into boundary');
});
test('Preview ratios preserve deep offsets without Number underflow', () => {
  const tiny = 1n << 180n;
  assert(fixedRatio(tiny, tiny * 4n) === 0.25, 'Positive ratio lost');
  assert(fixedRatio(-tiny, tiny * 4n) === -0.25, 'Negative ratio lost');
  assert(fixedRatio(0n, tiny) === 0, 'Zero ratio lost');
});
document.querySelector('#results').textContent = results.join('\n');
document.title = `${results.filter(item => item.startsWith('PASS')).length}/${results.length} precision tests passed`;
