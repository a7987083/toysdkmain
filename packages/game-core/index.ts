export type GameState = 'idle' | 'running' | 'paused' | 'disposed';

export interface GameHooks<Config> {
  start(config: Readonly<Config>): void | Promise<void>;
  pause?(): void | Promise<void>;
  resume?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

export class GameLifecycle<Config> {
  private readonly events = new EventTarget();
  private queue: Promise<unknown> = Promise.resolve();
  private current: GameState = 'idle';
  private requestedPause = false;

  constructor(
    private readonly config: Readonly<Config>,
    private readonly hooks: GameHooks<Config>,
    private readonly visibility: VisibilitySource | null = globalThis.document ?? null,
  ) {}

  get state(): GameState { return this.current; }

  onStateChange(listener: (state: GameState) => void): () => void {
    const wrapped = (event: Event) => listener((event as CustomEvent<GameState>).detail);
    this.events.addEventListener('state', wrapped);
    return () => this.events.removeEventListener('state', wrapped);
  }

  onError(listener: (error: unknown) => void): () => void {
    const wrapped = (event: Event) => listener((event as CustomEvent<unknown>).detail);
    this.events.addEventListener('error', wrapped);
    return () => this.events.removeEventListener('error', wrapped);
  }

  start(): Promise<void> {
    return this.enqueue(async () => {
      this.requireActive();
      if (this.current === 'idle') {
        await this.hooks.start(this.config);
        this.visibility?.addEventListener('visibilitychange', this.onVisibility);
        this.setState('running');
      }
      await this.reconcilePause();
    });
  }

  pause(): Promise<void> { return this.setPaused(true); }
  resume(): Promise<void> { return this.setPaused(false); }

  dispose(): Promise<void> {
    return this.enqueue(async () => {
      if (this.current === 'disposed') return;
      this.visibility?.removeEventListener('visibilitychange', this.onVisibility);
      this.setState('disposed');
      await this.hooks.dispose?.();
    });
  }

  private setPaused(paused: boolean): Promise<void> {
    return this.enqueue(async () => {
      this.requireActive();
      this.requestedPause = paused;
      await this.reconcilePause();
    });
  }

  private requireActive(): void {
    if (this.current === 'disposed') throw new Error('game_disposed');
  }

  private setState(state: GameState): void {
    this.current = state;
    this.events.dispatchEvent(new CustomEvent('state', { detail: state }));
  }

  private async reconcilePause(): Promise<void> {
    const shouldPause = this.requestedPause || this.visibility?.hidden === true;
    if (shouldPause && this.current === 'running') {
      await this.hooks.pause?.();
      this.setState('paused');
    } else if (!shouldPause && this.current === 'paused') {
      await this.hooks.resume?.();
      this.setState('running');
    }
  }

  private readonly onVisibility = () => {
    void this.enqueue(() => this.reconcilePause()).catch(() => {});
  };

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(error => {
      this.events.dispatchEvent(new CustomEvent('error', { detail: error }));
    });
    return result;
  }
}
