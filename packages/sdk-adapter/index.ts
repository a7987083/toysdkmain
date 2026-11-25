import {
  type Board, type KV, type PromiseMethod, type RankQuery, type SubscriptionMethod, type ToySDK,
  type Unsubscribe, promiseMethods, subscriptionMethods,
} from '../sdk-contract/index.js';
import { SdkDiagnostics } from '../sdk-diagnostics/index.js';
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
    readonly outcome?: 'unknown' | 'not_sent' | 'rejected',
    readonly hostSettled?: Promise<void>,
  ) {
    super(method ? `${type}: ${method}` : type, { cause });
    this.name = 'ToyKitError';
  }

  get category(): string {
    if (this.code === 307044) return 'rate_limited';
    if (['user_denied', 'no_permission', 'not_logged_in', 'age_restricted'].includes(this.type)) return 'permission_denied';
    return this.type;
  }
}

function normalize(reason: unknown, method: keyof ToySDK): ToyKitError {
  if (reason instanceof ToyKitError) return reason;
  const error = reason as ApiError | undefined;
  const type = typeof error?.type === 'string' ? error.type
    : typeof error?.message === 'string' && error.message.startsWith('invalid_param') ? 'invalid_param' : 'sdk_error';
  return new ToyKitError(type, method, typeof error?.code === 'number' ? error.code : undefined, reason);
}

export interface AdapterOptions {
  diagnostics?: SdkDiagnostics;
  timeoutMs?: number;
  /** Optional ceiling for unsettled upstream requests, including timed-out requests. */
  maxPending?: number;
}

const getWindowSdk = () => (globalThis as typeof globalThis & { toy?: Partial<ToySDK> }).toy;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const promises = new Set<string>(promiseMethods);
const subscriptions = new Set<string>(subscriptionMethods);
const writes = new Set<PromiseMethod>([
  'setCloudStorage', 'removeCloudStorage', 'setSharedStorage', 'removeSharedStorage', 'submitScore',
]);
const retryableReads = new Set<PromiseMethod>(['getCloudStorage', 'getSharedStorage', 'getRankList', 'getMyRank']);

export class ToyAdapter {
  private readonly subscriptions = new Set<Unsubscribe>();
  private readonly streams = new Set<MediaStream>();
  private readonly scoreSubmissions = new Set<string>();
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private pending = 0;
  private disposed = false;
  private readonly waiters = new Set<() => void>();
  private readonly releasing = new WeakMap<MediaStream, Promise<void>>();
  private disposal?: Promise<void>;
  private waiting = 0;
  readonly telemetry: SdkDiagnostics;

  constructor(private readonly sdk: Partial<ToySDK>, options: AdapterOptions = {}) {
    if (!sdk) throw new ToyKitError('sdk_unavailable');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxPending = options.maxPending ?? 16;
    this.telemetry = options.diagnostics ?? new SdkDiagnostics();
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 0x7fffffff
      || (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1)) {
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
      waiting: this.waiting,
      activeStreams: this.streams.size,
    };
  }

  async supports(method: keyof ToySDK): Promise<boolean> {
    if (!promises.has(method) && !subscriptions.has(method)) throw new ToyKitError('invalid_param');
    if (this.disposed || method === 'getAuthorVideoRange') return false;
    if (typeof this.sdk[method] !== 'function') return false;
    if (method === 'isSupport') return true;
    return this.call('isSupport', method);
  }

  call<K extends PromiseMethod>(method: K, ...args: Parameters<ToySDK[K]>): Promise<Awaited<ReturnType<ToySDK[K]>>>;
  call(method: PromiseMethod, ...args: unknown[]): Promise<unknown> {
    return this.invoke(method, args);
  }

  /** The signal ends the caller's wait. The host may still execute an already submitted operation. */
  callWithSignal<K extends PromiseMethod>(signal: AbortSignal, method: K, ...args: Parameters<ToySDK[K]>): Promise<Awaited<ReturnType<ToySDK[K]>>>;
  callWithSignal(signal: AbortSignal, method: PromiseMethod, ...args: unknown[]): Promise<unknown> {
    return this.invoke(method, args, signal);
  }

  private async invoke(method: PromiseMethod, args: unknown[], signal?: AbortSignal): Promise<unknown> {
    if (!promises.has(method)) throw new ToyKitError('invalid_param');
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    let abort: (() => void) | undefined;
    let dispatched = false;
    let hostSettled: Promise<void> | undefined;
    let abandoned = false;
    let outcome: 'ok' | 'timeout' | 'rate_limited' | 'error' = 'ok';
    let code: number | undefined;
    const acquiresStream = method === 'requestCamera' || method === 'requestMicrophone';
    const mutation = writes.has(method) ? 'unknown' : undefined;
    try {
      if (this.disposed) throw new ToyKitError('disposed', method);
      if (signal?.aborted) throw new ToyKitError('cancelled', method);
      validateRequest(method, args);
      if (method === 'getAuthorVideoRange') throw new ToyKitError('undocumented', method);
      if (method === 'stopMedia' && (this.streams.has(args[0] as MediaStream) || this.releasing.has(args[0] as MediaStream))) {
        return await this.releaseStream(args[0] as MediaStream);
      }
      const fn = this.sdk[method] as ((...args: unknown[]) => Promise<unknown>) | undefined;
      if (typeof fn !== 'function') throw new ToyKitError('unsupported', method);
      if (this.pending >= this.maxPending) throw new ToyKitError('busy', method);
      const score = method === 'submitScore' ? args[0] as { board?: Board; score: number } : undefined;
      const submission = score ? `${score.board ?? 1}:${score.score}` : undefined;
      if (submission && this.scoreSubmissions.has(submission)) throw new ToyKitError('duplicate_pending', method);
      this.pending++;
      if (submission) this.scoreSubmissions.add(submission);
      const settle = () => {
        this.pending--;
        if (submission) this.scoreSubmissions.delete(submission);
      };
      let request: Promise<unknown>;
      try {
        // Invoke inside the original gesture stack.
        dispatched = true;
        request = Promise.resolve(fn.apply(this.sdk, args));
      } catch (error) {
        settle();
        throw error;
      }
      if (mutation) hostSettled = request.then(() => {}, () => {});
      this.waiting++;
      const result = await Promise.race([
        request.then(value => {
          if (!validResponse(method, value)) throw new ToyKitError('invalid_response', method, undefined, undefined, mutation);
          if (acquiresStream && (abandoned || this.disposed)) this.cleanLateStream(value as MediaStream);
          return value;
        }).finally(settle),
        new Promise<never>((_, reject) => {
          cancel = () => {
            abandoned = true;
            reject(new ToyKitError('disposed', method, undefined, undefined, mutation));
          };
          this.waiters.add(cancel);
          abort = () => {
            abandoned = true;
            reject(new ToyKitError('cancelled', method, undefined, undefined, mutation));
          };
          signal?.addEventListener('abort', abort, { once: true });
          if (this.disposed) cancel();
          else if (signal?.aborted) abort();
          timer = setTimeout(() => {
            abandoned = true;
            reject(new ToyKitError('timeout', method, undefined, undefined, mutation));
          }, this.timeoutMs);
        }),
      ]);
      if (this.disposed) {
        if (acquiresStream) this.cleanLateStream(result as MediaStream);
        throw new ToyKitError('disposed', method, undefined, undefined, mutation);
      }
      if (acquiresStream) this.streams.add(result as MediaStream);
      return result;
    } catch (reason) {
      const error = normalize(reason, method);
      code = error.code;
      outcome = error.type === 'timeout' ? 'timeout' : code === 307044 ? 'rate_limited' : 'error';
      if (mutation) {
        const stage = !dispatched ? 'not_sent' : error.type === 'http_error' && error.code === 307044 ? 'rejected' : 'unknown';
        throw new ToyKitError(error.type, method, error.code, error, stage, hostSettled);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      if (cancel) {
        this.waiters.delete(cancel);
        this.waiting--;
      }
      this.telemetry.record({ event: 'request', method, outcome, elapsedMs: performance.now() - started,
        level: outcome === 'ok' ? 'debug' : 'warn', code });
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
        await pause((200 + Math.random() * 100) * 2 ** attempt);
      }
    }
  }

  subscribe<K extends SubscriptionMethod>(method: K, listener: Parameters<ToySDK[K]>[0]): Unsubscribe;
  subscribe(method: SubscriptionMethod, listener: (...args: never[]) => void): Unsubscribe {
    if (!subscriptions.has(method) || arguments.length !== 2) throw new ToyKitError('invalid_param');
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
        const report = () => this.telemetry.record({ level: 'error', event: 'callback', method, outcome: 'error', elapsedMs: 0 });
        try {
          const result: unknown = listener(...args);
          if (result != null) void Promise.resolve(result).catch(report);
        } catch { report(); }
      });
      if (typeof unsubscribe !== 'function') {
        active = false;
        throw new ToyKitError('invalid_response', method);
      }
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

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    for (const cancel of this.waiters) cancel();
    this.disposal = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        ...[...this.subscriptions].map(async off => off()),
        ...[...this.streams].map(stream => this.releaseStream(stream)),
      ]);
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, 'sdk_dispose_failed');
    });
    return this.disposal;
  }

  private cleanLateStream(stream: MediaStream): void {
    void this.releaseStream(stream).catch(() => {});
  }

  private releaseStream(stream: MediaStream): Promise<void> {
    const prior = this.releasing.get(stream);
    if (prior) return prior;
    const result = Promise.resolve().then(() => this.stopTracksAndHost(stream));
    this.releasing.set(stream, result);
    return result;
  }

  private async stopTracksAndHost(stream: MediaStream): Promise<void> {
    try {
      this.streams.delete(stream);
      let trackError: unknown;
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch (error) { trackError = error; }
      }
      const request = this.sdk.stopMedia?.(stream);
      if (request) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([request, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ToyKitError('timeout', 'stopMedia')), this.timeoutMs);
          })]);
        } finally {
          clearTimeout(timer);
        }
      }
      if (trackError) throw trackError;
    } catch (error) {
      this.telemetry.record({ level: 'error', event: 'cleanup', method: 'stopMedia', outcome: 'error', elapsedMs: 0 });
      throw normalize(error, 'stopMedia');
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
