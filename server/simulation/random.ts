import { createHash } from "node:crypto";

export class SeededRandom {
  private state: number;
  constructor(seed: string) { this.state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 0x9e3779b9; }
  next(): number { let value = this.state; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; this.state = value >>> 0; return this.state / 0x100000000; }
  between(minimum: number, maximum: number): number { return minimum + this.next() * (maximum - minimum); }
  normal(mean = 0, deviation = 1): number { const a = Math.max(this.next(), Number.EPSILON); const b = this.next(); return mean + deviation * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }
}

export function stream(seed: string, planId: string, phase: string, ordinal: number, name: string): SeededRandom {
  return new SeededRandom(`${seed}\u0000${planId}\u0000${phase}\u0000${ordinal}\u0000${name}`);
}
