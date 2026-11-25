import { promiseMethods, subscriptionMethods, type ToySDK } from '../sdk-contract/index.js';

export interface DiagnosticEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  event: 'request' | 'callback' | 'cleanup';
  method: keyof ToySDK;
  outcome: 'ok' | 'timeout' | 'rate_limited' | 'error';
  elapsedMs: number;
  code?: number;
}

const methods = new Set<string>([...promiseMethods, ...subscriptionMethods]);
const levels = new Set<string>(['debug', 'info', 'warn', 'error']);
const events = new Set<string>(['request', 'callback', 'cleanup']);
const outcomes = new Set<string>(['ok', 'timeout', 'rate_limited', 'error']);

export class SdkDiagnostics {
  private readonly entries: DiagnosticEntry[] = [];
  private cursor = 0;
  private readonly counters = { ok: 0, timeout: 0, rate_limited: 0, error: 0 };

  constructor(private readonly capacity = 100, private readonly sink?: (entry: Readonly<DiagnosticEntry>) => void) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) throw new RangeError('diagnostic_capacity');
  }

  record(entry: DiagnosticEntry): void {
    if (!methods.has(entry.method) || !levels.has(entry.level) || !events.has(entry.event) || !outcomes.has(entry.outcome)) return;
    const { level, event, method, outcome, elapsedMs, code } = entry;
    const safe = Object.freeze({
      level, event, method, outcome, elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : 0,
      ...(Number.isSafeInteger(code) ? { code } : {}),
    });
    if (event === 'request') this.counters[outcome]++;
    this.entries[this.cursor] = safe;
    this.cursor = (this.cursor + 1) % this.capacity;
    try { this.sink?.(safe); } catch { /* A consumer must not interrupt SDK operations. */ }
  }

  report() {
    const entries = this.entries.length < this.capacity ? [...this.entries]
      : [...this.entries.slice(this.cursor), ...this.entries.slice(0, this.cursor)];
    return { counters: { ...this.counters }, entries };
  }
}
