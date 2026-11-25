import type { ToyAdapter } from '../sdk-adapter/index.js';

import type { ToySession } from '../sdk-session/index.js';

export type ChargeState = 'unknown' | 'checking' | 'locked' | 'unlocked' | 'unavailable';

type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

export class ChargeAccess {
  private readonly events = new EventTarget();
  private state: ChargeState = 'unknown';
  private generation = 0;
  private disposed = false;
  private unwatch?: () => void;
  private offSession?: () => void;
  private dirty = false;
  private pending?: Promise<ChargeState>;

  constructor(private readonly adapter: ToyAdapter, private readonly minPrice = 1200, private readonly session?: ToySession) {
    if (!Number.isSafeInteger(minPrice) || minPrice < 1200) throw new Error('invalid_charge_price');
    this.offSession = session?.onChange(state => {
      this.generation++;
      this.dirty = false;
      this.pending = undefined;
      this.transition('unknown');
      if (state.status === 'user') void this.check();
    });
  }

  get current(): ChargeState { return this.state; }
  get unlocked(): boolean { return this.state === 'unlocked'; }

  onChange(listener: (state: ChargeState) => void): () => void {
    const wrapped = (event: Event) => listener((event as CustomEvent<ChargeState>).detail);
    this.events.addEventListener('change', wrapped);
    return () => this.events.removeEventListener('change', wrapped);
  }

  async refresh(): Promise<ChargeState> {
    this.requireActive();
    if (this.session && this.session.current.status !== 'user') return 'unavailable';
    const generation = ++this.generation;
    this.transition('checking');
    let state: ChargeState = 'unavailable';
    try {
      const result = await this.adapter.call('getChargeUnlock', { minPrice: this.minPrice });
      if (result.status === 'ok') state = result.data.unlocked ? 'unlocked' : 'locked';
    } catch {
      // The adapter exposes diagnostics when a caller needs the upstream error.
    }
    if (generation === this.generation) this.transition(state);
    return this.current;
  }

  /** Coalesce automatic rechecks. Explicit refresh remains able to supersede an earlier request. */
  check(): Promise<ChargeState> {
    if (!this.pending) {
      const result = this.refresh().then(state => {
        if (!this.dirty || this.disposed || this.pending !== result) return state;
        this.dirty = false;
        return this.refresh();
      }).finally(() => { if (this.pending === result) this.pending = undefined; });
      this.pending = result;
    }
    return this.pending;
  }

  private changed(): void {
    if (this.pending) this.dirty = true;
    else void this.check();
  }

  /** Invoke directly from a user gesture. Completion confirms only that the panel opened. */
  async openPanel(): Promise<void> {
    this.requireActive();
    return this.adapter.call('openChargePanel', { minPrice: this.minPrice });
  }

  watchVisibility(visibility: VisibilitySource = globalThis.document): () => void {
    this.requireActive();
    if (!visibility) throw new Error('visibility_unavailable');
    this.unwatch?.();
    let offHost: (() => void) | undefined;
    let active = true;
    const listener = () => {
      if (!visibility.hidden && !this.disposed) this.changed();
    };
    // The public event may exist even when the host omits it from its ability list.
    try {
      offHost = this.adapter.subscribe('onChargeUnlockChange', () => {
        if (!this.disposed && active) this.changed();
      });
    } catch { /* Visibility remains the fallback. */ }
    const off = () => {
      if (!active) return;
      active = false;
      visibility.removeEventListener('visibilitychange', listener);
      if (this.unwatch === off) this.unwatch = undefined;
      offHost?.();
    };
    visibility.addEventListener('visibilitychange', listener);
    this.unwatch = off;
    return off;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.offSession?.();
    try { this.unwatch?.(); } finally { this.transition('unavailable'); }
  }

  private requireActive(): void {
    if (this.disposed) throw new Error('charge_access_disposed');
  }

  private transition(state: ChargeState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.dispatchEvent(new CustomEvent('change', { detail: state }));
  }
}
