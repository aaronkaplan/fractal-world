"use strict";

// Fixed-point coordinates grow with zoom depth. No Number conversion is used
// for absolute deep-zoom coordinates, where adjacent pixels differ by < 1e-300.
class PrecisionView {
  constructor() { this.reset(); }

  reset() {
    this.bits = 128;
    this.logZoom = 0;
    this.x = -(1n << 127n);
    this.y = 0n;
  }

  spanAt(logZoom = this.logZoom) {
    const exponent = Math.floor(logZoom);
    const mantissa = BigInt(Math.round(3 * 2 ** (-(logZoom - exponent)) * 2 ** 50));
    const shift = this.bits - exponent - 50;
    return shift >= 0 ? mantissa << BigInt(shift) : mantissa >> BigInt(-shift);
  }

  zoom(amount, cursor, width, height) {
    const next = Math.max(-1, this.logZoom + amount / Math.LN2);
    const nextBits = Math.max(this.bits, Math.ceil((next + 96) / 64) * 64);
    if (nextBits > this.bits) {
      const shift = BigInt(nextBits - this.bits);
      this.x <<= shift;
      this.y <<= shift;
      this.bits = nextBits;
    }
    const difference = this.spanAt() - this.spanAt(next);
    // Cursor fractions need screen precision, not absolute-coordinate precision.
    const denominator = 1n << 48n;
    const dx = BigInt(Math.round((cursor.x - width / 2) / height * 2 ** 48));
    const dy = BigInt(Math.round((height / 2 - cursor.y) / height * 2 ** 48));
    this.x += difference * dx / denominator;
    this.y += difference * dy / denominator;
    this.logZoom = next;
  }

  number(value) {
    const magnitude = value < 0n ? -value : value;
    const shift = Math.max(0, magnitude.toString(2).length - 52);
    const number = Number(magnitude >> BigInt(shift)) * 2 ** (shift - this.bits);
    return value < 0n ? -number : number;
  }

  label() {
    const decimal = this.logZoom * Math.LOG10E * Math.LN2;
    if (decimal < 6) return `${(2 ** this.logZoom).toFixed(1)}×`;
    const exponent = Math.floor(decimal);
    return `${(10 ** (decimal - exponent)).toFixed(2)}e${exponent}×`;
  }

  snapshot() {
    return { x: this.x, y: this.y, bits: this.bits, span: this.spanAt(), logZoom: this.logZoom };
  }
}

// Independent CPU oracle for deterministic numerical regression tests only.
function preciseEscape(cx, cy, bits, iterations) {
  const shift = BigInt(bits);
  const one = 1n << shift;
  const mul = (a, b) => a * b >> shift;
  const yy = mul(cy, cy);
  const bulbX = cx + one;
  if (mul(bulbX, bulbX) + yy < one / 16n) return -1;
  const quarterX = cx - one / 4n;
  const q = mul(quarterX, quarterX) + yy;
  if (mul(q, q + quarterX) < yy / 4n) return -1;
  let x = 0n, y = 0n;
  const bailout = 256n * one;
  for (let index = 0; index < iterations; index++) {
    const xx = mul(x, x), y2 = mul(y, y);
    y = mul(2n * x, y) + cy;
    x = xx - y2 + cx;
    const magnitude = mul(x, x) + mul(y, y);
    if (magnitude > bailout) {
      // Only the escaped magnitude (bounded in size) is converted for coloring.
      const reduced = Number(magnitude >> BigInt(Math.max(0, bits - 32))) / 2 ** Math.min(bits, 32);
      return index + 1 - Math.log2(Math.log2(Math.sqrt(reduced)));
    }
  }
  return -1;
}

function fixedRatio(numerator, denominator) {
  if (numerator === 0n) return 0;
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const aShift = Math.max(0, magnitude.toString(2).length - 52);
  const bShift = Math.max(0, denominator.toString(2).length - 52);
  const ratio = Number(magnitude >> BigInt(aShift)) / Number(denominator >> BigInt(bShift)) * 2 ** (aShift - bShift);
  return negative ? -ratio : ratio;
}
