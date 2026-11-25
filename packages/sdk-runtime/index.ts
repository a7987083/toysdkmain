import { ToyAdapter, ToyKitError, type AdapterOptions } from '../sdk-adapter/index.js';
import type { ToySDK } from '../sdk-contract/index.js';

export type RuntimeState = 'idle' | 'initializing' | 'ready' | 'failed' | 'disposing' | 'disposed';

export interface RuntimeOptions {
  /** Explicit provider for fixtures or alternate supported host integration. */
  sdk?: Partial<ToySDK>;
  timeoutMs?: number;
  adapter?: AdapterOptions;
  /** Optionally require a successful public bridge round trip. */
  verifyBridge?: boolean;
}

export class ToyRuntime {
  private controller?: AbortController;
  private pending?: Promise<ToyAdapter>;
  private adapter?: ToyAdapter;
  private disposal?: Promise<void>;
  private current: RuntimeState = 'idle';
  private readonly abilities = new Map<keyof ToySDK, Promise<boolean>>();

  constructor(private readonly options: RuntimeOptions = {}) {}

  get state(): RuntimeState { return this.current; }
  get environment(): 'unknown' | 'injected' { return this.options.sdk ? 'injected' : 'unknown'; }

  initialize(): Promise<ToyAdapter> {
    if (this.disposal) return this.disposal.then(() => this.initialize());
    if (this.adapter) return Promise.resolve(this.adapter);
    if (this.pending) return this.pending;
    const controller = new AbortController();
    this.controller = controller;
    this.current = 'initializing';
    this.pending = this.connect(controller.signal).then(adapter => {
      if (controller.signal.aborted) {
        void adapter.dispose().catch(() => {});
        throw new ToyKitError('disposed');
      }
      this.current = 'ready';
      this.adapter = adapter;
      return adapter;
    }).catch(error => {
      if (!controller.signal.aborted) this.current = 'failed';
      throw error;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async supports(method: keyof ToySDK): Promise<boolean> {
    const adapter = await this.initialize();
    const existing = this.abilities.get(method);
    if (existing) return existing;
    const result = adapter.supports(method).catch(error => {
      if (this.abilities.get(method) === result) this.abilities.delete(method);
      throw error;
    });
    this.abilities.set(method, result);
    return result;
  }

  clearCapabilities(): void { this.abilities.clear(); }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.current = 'disposing';
    this.controller?.abort();
    this.clearCapabilities();
    const adapter = this.adapter;
    this.adapter = undefined;
    this.disposal = Promise.allSettled([this.pending, adapter?.dispose()]).then(([, cleanup]) => {
      if (cleanup?.status === 'rejected') throw cleanup.reason;
    }).finally(() => {
      this.current = 'disposed';
      this.disposal = undefined;
    });
    return this.disposal;
  }

  private async connect(signal: AbortSignal): Promise<ToyAdapter> {
    const timeout = this.options.timeoutMs ?? 3000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 0x7fffffff) throw new ToyKitError('invalid_param');
    const deadline = performance.now() + timeout;
    for (;;) {
      if (signal.aborted) throw new ToyKitError('disposed');
      const host = (globalThis as typeof globalThis & { toy?: Partial<ToySDK> }).toy;
      const sdk = this.options.sdk ?? host;
      if (sdk) {
        if (typeof sdk.isSupport !== 'function') throw new ToyKitError('bridge_unavailable');
        const adapter = new ToyAdapter(sdk, this.options.adapter);
        if (!this.options.verifyBridge) return adapter;
        const verification = new AbortController();
        const cancel = () => verification.abort();
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new ToyKitError('initialization_timeout');
        const timer = setTimeout(cancel, remaining);
        signal.addEventListener('abort', cancel, { once: true });
        try {
          await adapter.callWithSignal(verification.signal, 'isSupport', 'getUserProfile');
          return adapter;
        } catch (error) {
          await adapter.dispose();
          if (signal.aborted) throw new ToyKitError('disposed');
          if (verification.signal.aborted) throw new ToyKitError('initialization_timeout');
          throw new ToyKitError('bridge_unavailable', undefined, error instanceof ToyKitError ? error.code : undefined, error);
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
        }
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new ToyKitError(timeout === 0 ? 'sdk_unavailable' : 'initialization_timeout');
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(25, remaining)));
    }
  }
}

export const toyRuntime = new ToyRuntime();
