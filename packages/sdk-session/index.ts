import { ToyAdapter, ToyKitError } from '../sdk-adapter/index.js';
import type { ToySDK } from '../sdk-contract/index.js';
import { sharedCloud, toyCloud, type SaveSession, type SaveCloud } from '../game-storage/index.js';

export type SessionState =
  | { status: 'unknown' | 'guest'; generation: number }
  | { status: 'user'; generation: number; profile: Omit<Awaited<ReturnType<ToySDK['getUserProfile']>>, 'toyOpenId'>;
      persistentIdentity: boolean };

type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

export class ToySession {
  private readonly events = new EventTarget();
  private state: SessionState = { status: 'unknown', generation: 0 };
  private identity?: string;
  private epoch = 0;
  private disposed = false;
  private offVisibility?: () => void;

  constructor(private readonly adapter: ToyAdapter) {}

  get current(): Readonly<SessionState> { return this.state; }

  onChange(listener: (state: Readonly<SessionState>) => void): () => void {
    const wrapped = () => listener(this.current);
    this.events.addEventListener('session', wrapped);
    return () => this.events.removeEventListener('session', wrapped);
  }

  async refresh(): Promise<Readonly<SessionState>> {
    if (this.disposed) throw new ToyKitError('disposed');
    const epoch = ++this.epoch;
    this.update({ status: 'unknown' });
    if (this.disposed || this.epoch !== epoch) return this.state;
    try {
      const { toyOpenId, avatar, nickname } = await this.adapter.profile();
      if (this.epoch === epoch) {
        this.identity = toyOpenId || undefined;
        this.update({ status: 'user', profile: Object.freeze({ avatar, nickname }), persistentIdentity: Boolean(this.identity) });
      }
    } catch (error) {
      if (this.epoch === epoch) {
        this.identity = undefined;
        if (error instanceof ToyKitError && error.type === 'not_logged_in') this.update({ status: 'guest' });
      }
    }
    return this.state;
  }

  enterGuest(): void {
    if (this.disposed) throw new ToyKitError('disposed');
    this.epoch++;
    this.identity = undefined;
    this.update({ status: 'guest' });
  }

  /** Recheck only after a developer-initiated profile lookup has yielded a stable identifier. */
  watchVisibility(source: VisibilitySource = globalThis.document): () => void {
    if (this.disposed) throw new ToyKitError('disposed');
    if (!source) throw new ToyKitError('unsupported');
    this.offVisibility?.();
    const listener = () => {
      if (!source.hidden && !this.disposed && this.identity) void this.refresh();
    };
    const off = () => {
      source.removeEventListener('visibilitychange', listener);
      if (this.offVisibility === off) this.offVisibility = undefined;
    };
    source.addEventListener('visibilitychange', listener);
    this.offVisibility = off;
    return off;
  }

  scope(): () => void {
    const generation = this.state.generation;
    if (this.state.status !== 'user') throw new ToyKitError('session_changed');
    return () => {
      if (this.state.status !== 'user' || this.state.generation !== generation) throw new ToyKitError('session_changed');
    };
  }

  /** Local-only opaque key for scoped caches. Never use as an authentication credential. */
  cacheIdentity(): string {
    this.scope();
    if (!this.identity) throw new ToyKitError('session_identity_unavailable');
    return this.identity;
  }

  storage(storageId?: string): SaveSession {
    if (this.disposed) throw new ToyKitError('disposed');
    if (this.state.status === 'guest') return { mode: 'guest' };
    const identity = this.identity;
    if (!identity) throw new ToyKitError('session_identity_unavailable');
    const check = this.scope();
    const cloud = storageId === undefined ? toyCloud(this.adapter) : sharedCloud(this.adapter, storageId);
    const guard = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) =>
      async (...args: Args) => {
        check();
        const result = await operation(...args);
        check();
        return result;
      };
    const scoped: SaveCloud = {
      scope: cloud.scope, load: guard(cloud.load), save: guard(cloud.save), remove: guard(cloud.remove),
    };
    return { mode: 'cloud', playerKey: identity, cloud: scoped, check };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.identity = undefined;
    this.offVisibility?.();
    this.update({ status: 'unknown' });
  }

  private update(state: { status: 'unknown' | 'guest' } | Omit<Extract<SessionState, { status: 'user' }>, 'generation'>): void {
    this.state = Object.freeze({ ...state, generation: this.state.generation + 1 });
    this.events.dispatchEvent(new Event('session'));
  }
}
