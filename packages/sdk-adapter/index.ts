import {
  type Board, type KV, type PromiseMethod, type RankQuery, type SubscriptionMethod, type ToySDK,
  type Unsubscribe,
} from '../sdk-contract/index.js';
import { validCharge, validResponse, validateRequest } from './validation.js';

type ApiError = {
  type?: unknown;
  code?: unknown;
  message?: unknown;
};

export class ToyKitError extends Error {
  constructor(
    readonly type: string,
    readonly method?: keyof ToySDK,
    readonly code?: number,
    cause?: unknown,
  ) {
    super(method ? `${type}: ${method}` : type, { cause });
    this.name = 'ToyKitError';
  }
}

function normalize(reason: unknown, method: keyof ToySDK): ToyKitError {
  if (reason instanceof ToyKitError) return reason;
  const error = reason as ApiError | undefined;
  const type = typeof error?.type === 'string' ? error.type
    : typeof error?.message === 'string' && error.message.startsWith('invalid_param') ? 'invalid_param' : 'sdk_error';
  return new ToyKitError(type, method, typeof error?.code === 'number' ? error.code : undefined, reason);
}

interface AdapterOptions {
  timeoutMs?: number;
  /** Optional ceiling for unsettled upstream requests, including timed-out requests. */
  maxPending?: number;
}

const getWindowSdk = () => (globalThis as typeof globalThis & { toy?: Partial<ToySDK> }).toy;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const retryableReads = new Set<PromiseMethod>(['getCloudStorage', 'getSharedStorage', 'getRankList', 'getMyRank']);

export class ToyAdapter {
  private readonly subscriptions = new Set<Unsubscribe>();
  private readonly streams = new Set<MediaStream>();
  private readonly scoreSubmissions = new Set<string>();
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private pending = 0;
  private disposed = false;

  constructor(private readonly sdk: Partial<ToySDK>, options: AdapterOptions = {}) {
    if (!sdk) throw new ToyKitError('sdk_unavailable');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxPending = options.maxPending ?? Infinity;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0
      || !(this.maxPending === Infinity || Number.isSafeInteger(this.maxPending) && this.maxPending > 0)) {
      throw new ToyKitError('invalid_param');
    }
  }

  static fromWindow(options?: AdapterOptions): ToyAdapter {
    const sdk = getWindowSdk();
    if (!sdk) throw new ToyKitError('sdk_unavailable');
    return new ToyAdapter(sdk, options);
  }

  static async waitForWindow(timeoutMs = 3000, options?: AdapterOptions): Promise<ToyAdapter> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new ToyKitError('invalid_param');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const sdk = getWindowSdk();
      if (sdk) return new ToyAdapter(sdk, options);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ToyKitError('sdk_unavailable');
      await pause(Math.min(remaining, 25));
    }
  }

  diagnostics() {
    return {
      source: this.sdk === getWindowSdk() ? 'window.toy' as const : 'injected' as const,
      hasCapabilityProbe: typeof this.sdk.isSupport === 'function',
      disposed: this.disposed,
      pending: this.pending,
    };
  }

  async supports(method: keyof ToySDK): Promise<boolean> {
    if (this.disposed) return false;
    if (typeof this.sdk[method] !== 'function') return false;
    if (method === 'isSupport') return true;
    return this.call('isSupport', method);
  }

  call<K extends PromiseMethod>(method: K, ...args: Parameters<ToySDK[K]>): Promise<Awaited<ReturnType<ToySDK[K]>>>;
  async call(method: PromiseMethod, ...args: unknown[]): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const acquiresStream = method === 'requestCamera' || method === 'requestMicrophone';
    try {
      if (this.disposed) throw new ToyKitError('disposed', method);
      const fn = this.sdk[method] as ((...args: unknown[]) => Promise<unknown>) | undefined;
      if (typeof fn !== 'function') throw new ToyKitError('unsupported', method);
      if (method !== 'stopMedia' && this.pending >= this.maxPending) throw new ToyKitError('busy', method);
      validateRequest(method, args);
      const score = method === 'submitScore' ? args[0] as { board?: Board; score: number } : undefined;
      const submission = score ? `${score.board ?? 1}:${score.score}` : undefined;
      if (submission && this.scoreSubmissions.has(submission)) throw new ToyKitError('duplicate_pending', method);
      // Start synchronously so the host can observe browser user activation.
      const request = Promise.resolve(fn.apply(this.sdk, args));
      this.pending++;
      if (submission) this.scoreSubmissions.add(submission);
      const result = await Promise.race([
        request.then(value => {
          if (!validResponse(method, value)) throw new ToyKitError('invalid_response', method);
          if (acquiresStream && timedOut) void this.releaseStream(value as MediaStream);
          return value;
        }).finally(() => {
          this.pending--;
          if (submission) this.scoreSubmissions.delete(submission);
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new ToyKitError('timeout', method));
          }, this.timeoutMs);
        }),
      ]);
      if (acquiresStream) {
        if (this.disposed) {
          void this.releaseStream(result as MediaStream);
          throw new ToyKitError('disposed', method);
        }
        this.streams.add(result as MediaStream);
      }
      if (method === 'stopMedia') this.streams.delete(args[0] as MediaStream);
      return result;
    } catch (reason) {
      throw normalize(reason, method);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Opt-in bounded retries for read operations explicitly rejected for rate limiting. */
  async readWithBackoff<K extends 'getCloudStorage' | 'getSharedStorage' | 'getRankList' | 'getMyRank'>(
    method: K, ...args: Parameters<ToySDK[K]>
  ): Promise<Awaited<ReturnType<ToySDK[K]>>> {
    if (!retryableReads.has(method)) throw new ToyKitError('invalid_param', method);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.call(method, ...args);
      } catch (error) {
        if (!(error instanceof ToyKitError) || error.code !== 307044 || attempt >= 2) throw error;
        await pause(250 * 2 ** attempt);
      }
    }
  }

  subscribe<K extends SubscriptionMethod>(method: K, listener: Parameters<ToySDK[K]>[0]): Unsubscribe;
  subscribe(method: SubscriptionMethod, listener: (...args: never[]) => void): Unsubscribe {
    try {
      if (this.disposed) throw new ToyKitError('disposed', method);
      if (typeof listener !== 'function') throw new ToyKitError('invalid_param', method);
      const fn = this.sdk[method] as ((callback: typeof listener) => Unsubscribe) | undefined;
      if (typeof fn !== 'function') throw new ToyKitError('unsupported', method);
      let active = true;
      const unsubscribe = fn.call(this.sdk, (...args) => {
        if (!active || this.disposed) return;
        if (method === 'onChargeUnlockChange' && !validCharge(args[0])) return;
        if (method === 'onContainerChange' && !validResponse('getContainerState', args[0])) return;
        if (method === 'onPlayerChange' && !validResponse('getPlayerState', args[0])) return;
        listener(...args);
      });
      if (typeof unsubscribe !== 'function') throw new ToyKitError('invalid_response', method);
      const off = () => {
        if (!active) return;
        active = false;
        this.subscriptions.delete(off);
        unsubscribe();
      };
      if (this.disposed) off();
      else this.subscriptions.add(off);
      return off;
    } catch (reason) {
      throw normalize(reason, method);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const results = await Promise.allSettled([
      ...[...this.subscriptions].map(async off => off()),
      ...[...this.streams].map(stream => this.releaseStream(stream)),
    ]);
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'sdk_dispose_failed');
  }

  private async releaseStream(stream: MediaStream): Promise<void> {
    this.streams.delete(stream);
    // Stop local tracks immediately even when the host cleanup is slow or fails.
    for (const track of stream.getTracks()) track.stop();
    try {
      const request = this.sdk.stopMedia?.(stream);
      if (request) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([request, new Promise(resolve => { timer = setTimeout(resolve, this.timeoutMs); })]);
        } finally {
          clearTimeout(timer);
        }
      }
    } catch {
      // The local tracks have already stopped.
    }
  }

  load(keys?: string[]) { return this.call('getCloudStorage', keys); }
  save(items: KV) { return this.call('setCloudStorage', items); }
  remove(keys: string[]) { return this.call('removeCloudStorage', keys); }
  profile() { return this.call('getUserProfile'); }
  submit(score: number, board: Board = 1) { return this.call('submitScore', { board, score }); }
  ranks(req: RankQuery & { limit?: number } = {}) { return this.call('getRankList', req); }
  myRank(req: RankQuery = {}) { return this.call('getMyRank', req); }
}
