export type GameState = 'idle' | 'running' | 'paused' | 'disposed';

export interface GameHooks<Config> {
  start(config: Readonly<Config>, signal: AbortSignal): void | Promise<void>;
  pause?(signal: AbortSignal): void | Promise<void>;
  resume?(signal: AbortSignal): void | Promise<void>;
  dispose?(signal: AbortSignal): void | Promise<void>;
}

type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

export class GameLifecycle<Config> {
  private readonly events = new EventTarget();
  private queue: Promise<unknown> = Promise.resolve();
  private current: GameState = 'idle';
  private requestedPause = false;
  private readonly controller = new AbortController();
  private readonly listeners = new Set<() => void>();
  private disposal?: Promise<void>;
  private hookExecuting = false;
  private pendingGameHook?: Promise<void>;

  constructor(
    private readonly config: Readonly<Config>,
    private readonly hooks: GameHooks<Config>,
    private readonly visibility: VisibilitySource | null = globalThis.document ?? null,
    private readonly hookTimeoutMs = 15_000,
  ) {
    if (!Number.isSafeInteger(hookTimeoutMs) || hookTimeoutMs < 1 || hookTimeoutMs > 0x7fffffff) throw new RangeError('game_hook_timeout');
  }

  get state(): GameState { return this.current; }

  onStateChange(listener: (state: GameState) => void): () => void {
    const wrapped = (event: Event) => listener((event as CustomEvent<GameState>).detail);
    this.events.addEventListener('state', wrapped);
    const off = () => {
      this.events.removeEventListener('state', wrapped);
      this.listeners.delete(off);
    };
    this.listeners.add(off);
    return off;
  }

  onError(listener: (error: unknown) => void): () => void {
    const wrapped = (event: Event) => listener((event as CustomEvent<unknown>).detail);
    this.events.addEventListener('error', wrapped);
    const off = () => {
      this.events.removeEventListener('error', wrapped);
      this.listeners.delete(off);
    };
    this.listeners.add(off);
    return off;
  }

  start(): Promise<void> {
    return this.enqueue(async () => {
      this.requireActive();
      if (this.current === 'idle') {
        await this.runHook(signal => this.hooks.start(this.config, signal));
        this.requireActive();
        this.visibility?.addEventListener('visibilitychange', this.onVisibility);
        this.setState('running');
      }
      await this.reconcilePause();
    });
  }

  pause(): Promise<void> { return this.setPaused(true); }
  resume(): Promise<void> { return this.setPaused(false); }

  dispose(): Promise<void> {
    if (this.hookExecuting) return Promise.reject(new Error('game_hook_reentrant'));
    if (this.disposal) return this.disposal;
    this.disposal = this.enqueue(async () => {
      this.setState('disposed');
      await this.runHook(signal => this.hooks.dispose?.(signal), false);
    }).finally(() => {
      for (const off of this.listeners) off();
    });
    this.visibility?.removeEventListener('visibilitychange', this.onVisibility);
    this.controller.abort();
    return this.disposal;
  }

  private async runHook(operation: (signal: AbortSignal) => void | Promise<void>, duringGame = true): Promise<void> {
    const lifecycle = duringGame ? this.controller.signal : undefined;
    if (lifecycle?.aborted) throw new Error('game_disposed');
    if (duringGame && this.pendingGameHook) throw new Error('game_hook_pending');
    const hook = new AbortController();
    const cancel = () => hook.abort(new Error('game_disposed'));
    lifecycle?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => hook.abort(new Error('game_hook_timeout')), this.hookTimeoutMs);
    try {
      const aborted = new Promise<never>((_, reject) => {
        hook.signal.addEventListener('abort', () => reject(hook.signal.reason), { once: true });
      });
      const work = Promise.resolve().then(() => {
        if (hook.signal.aborted) return;
        this.hookExecuting = true;
        try { return operation(hook.signal); }
        finally { this.hookExecuting = false; }
      });
      const settled = work.finally(() => {
        if (this.pendingGameHook === settled) this.pendingGameHook = undefined;
      });
      if (duringGame) this.pendingGameHook = settled;
      await Promise.race([settled, aborted]);
    } finally {
      clearTimeout(timer);
      lifecycle?.removeEventListener('abort', cancel);
    }
  }

  private setPaused(paused: boolean): Promise<void> {
    return this.enqueue(async () => {
      this.requireActive();
      this.requestedPause = paused;
      await this.reconcilePause();
    });
  }

  private requireActive(): void {
    if (this.controller.signal.aborted || this.current === 'disposed') throw new Error('game_disposed');
  }

  private setState(state: GameState): void {
    this.current = state;
    this.events.dispatchEvent(new CustomEvent('state', { detail: state }));
  }

  private async reconcilePause(): Promise<void> {
    const shouldPause = this.requestedPause || this.visibility?.hidden === true;
    if (shouldPause && this.current === 'running') {
      await this.runHook(signal => this.hooks.pause?.(signal));
      this.requireActive();
      this.setState('paused');
    } else if (!shouldPause && this.current === 'paused') {
      await this.runHook(signal => this.hooks.resume?.(signal));
      this.requireActive();
      this.setState('running');
    }
  }

  private readonly onVisibility = () => {
    void this.enqueue(() => this.reconcilePause()).catch(() => {});
  };

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.hookExecuting) return Promise.reject(new Error('game_hook_reentrant'));
    const result = this.queue.then(operation);
    this.queue = result.catch(error => {
      this.events.dispatchEvent(new CustomEvent('error', { detail: error }));
    });
    return result;
  }
}
