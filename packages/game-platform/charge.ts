import type { ToyAdapter } from '../sdk-adapter/index.js';

export type ChargeState = 'unknown' | 'checking' | 'locked' | 'unlocked' | 'unavailable';

type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

export class ChargeAccess {
  private readonly events = new EventTarget();
  private state: ChargeState = 'unknown';
  private generation = 0;
  private disposed = false;
  private unwatch?: () => void;

  constructor(private readonly adapter: ToyAdapter, private readonly minPrice = 1200) {
    if (!Number.isSafeInteger(minPrice) || minPrice < 1200) throw new Error('invalid_charge_price');
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

  /** Invoke directly from a user gesture. Completion confirms only that the panel opened. */
  async openPanel(): Promise<void> {
    this.requireActive();
    return this.adapter.call('openChargePanel', { minPrice: this.minPrice });
  }

  watchVisibility(visibility: VisibilitySource = globalThis.document): () => void {
    this.requireActive();
    if (!visibility) throw new Error('visibility_unavailable');
    this.unwatch?.();
    const listener = () => {
      if (!visibility.hidden && !this.disposed) void this.refresh();
    };
    const off = () => {
      visibility.removeEventListener('visibilitychange', listener);
      if (this.unwatch === off) this.unwatch = undefined;
    };
    visibility.addEventListener('visibilitychange', listener);
    this.unwatch = off;
    return off;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.unwatch?.();
    this.transition('unavailable');
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
