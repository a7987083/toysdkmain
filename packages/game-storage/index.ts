import type { ToyAdapter } from '../sdk-adapter/index.js';
import { limits, validateKey, type KV } from '../sdk-contract/index.js';
import { SaveCodec, SaveError, type SaveSchema } from './codec.js';

export { SaveError, type SaveSchema } from './codec.js';

export interface SaveCloud {
  scope: string;
  load(keys: string[]): Promise<KV>;
  save(items: KV): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export function toyCloud(adapter: ToyAdapter): SaveCloud {
  return {
    scope: 'toy',
    load: keys => adapter.load(keys),
    save: items => adapter.save(items),
    remove: keys => adapter.remove(keys),
  };
}

export function sharedCloud(adapter: ToyAdapter, id: string): SaveCloud {
  return {
    scope: `shared:${id}`,
    load: keys => adapter.call('getSharedStorage', id, keys),
    save: items => adapter.call('setSharedStorage', id, items),
    remove: keys => adapter.call('removeSharedStorage', id, keys),
  };
}

export type SaveSession = { mode: 'guest' } | { mode: 'cloud'; playerKey: string; cloud: SaveCloud };

export interface SaveOptions<T> {
  /** Prefixes cloud keys and separates games sharing the same local origin. */
  namespace: string;
  schema: SaveSchema<T>;
  session: SaveSession;
  /** Pass an explicit Storage instance for a cache and queue durable across reloads. */
  cache?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

type RawSave = string | null;
type Entry = Readonly<{ base: RawSave; next?: RawSave; conflict?: RawSave }>;

export interface SyncReport {
  written: string[];
  deleted: string[];
  conflicts: string[];
}

const fields = new Set(['base', 'next', 'conflict']);
const rawSave = (value: unknown): value is RawSave => value === null || typeof value === 'string';
const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && Object.hasOwn(value, 'base')
  && Object.entries(value).every(([field, raw]) => fields.has(field) && rawSave(raw))
  && (!Object.hasOwn(value, 'conflict') || Object.hasOwn(value, 'next'));

export class GameStorage<T> {
  private readonly codec: SaveCodec<T>;
  private readonly prefix: string;
  private readonly cacheKey: string;
  private readonly cache: SaveOptions<T>['cache'];
  private readonly cloud?: SaveCloud;
  private entries: Map<string, Entry>;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(options: SaveOptions<T>) {
    validateKey(options.namespace);
    this.prefix = `${options.namespace.length}_${options.namespace}_`;
    if (this.prefix.length >= limits.maxKeyBytes) throw new SaveError('invalid_save');
    const session = options.session;
    if (session.mode === 'cloud') {
      if (!session.playerKey || !session.cloud.scope) throw new SaveError('invalid_save');
      this.cloud = session.cloud;
    }
    this.cacheKey = 'toygamekit:' + JSON.stringify([
      options.namespace, session.mode,
      ...(session.mode === 'cloud' ? [session.cloud.scope, session.playerKey] : []),
    ]);
    this.cache = options.cache;
    this.codec = new SaveCodec(options.schema);
    this.entries = this.loadCache();
  }

  get(key: string): T | undefined {
    this.remoteKey(key);
    const entry = this.entries.get(key);
    const raw = entry?.next !== undefined ? entry.next : entry?.base;
    return raw == null ? undefined : this.codec.decode(raw);
  }

  pending(): string[] {
    return [...this.entries].filter(([, entry]) => entry.next !== undefined).map(([key]) => key);
  }

  async put(key: string, value: T): Promise<void> {
    this.requireOpen();
    const snapshot = this.codec.encode(value);
    return this.enqueue(() => this.stage(key, snapshot));
  }

  remove(key: string): Promise<void> {
    return this.enqueue(() => this.stage(key, null));
  }

  /** Read selected keys and flush only their pending changes. */
  sync(keys?: readonly string[]): Promise<SyncReport> {
    const selection = keys && [...keys];
    return this.enqueue(async () => {
      const cloud = this.cloud;
      if (!cloud) throw new Error('cloud_session_required');
      const wanted = [...new Set(selection ?? this.entries.keys())];
      const report: SyncReport = { written: [], deleted: [], conflicts: [] };
      if (!wanted.length) return report;
      if (wanted.length > limits.maxKeys) throw new SaveError('invalid_save');
      const remoteKeys = wanted.map(key => this.remoteKey(key));
      const remote = await cloud.load(remoteKeys);
      this.requireOpen();
      const entries = new Map(this.entries);
      const writes = new Map<string, string>();
      const deletes: string[] = [];
      for (const [index, key] of wanted.entries()) {
        const remoteKey = remoteKeys[index]!;
        const raw = Object.hasOwn(remote, remoteKey) ? remote[remoteKey]! : null;
        const entry = entries.get(key);
        if (entry?.next === undefined || entry.next === raw) {
          this.updateBase(entries, key, raw);
        } else if (entry.base !== raw) {
          entries.set(key, { ...entry, conflict: raw });
          report.conflicts.push(key);
        } else {
          entries.set(key, { base: raw, next: entry.next });
          if (entry.next === null) deletes.push(key);
          else writes.set(key, entry.next);
        }
      }
      this.commit(entries);
      if (writes.size) {
        this.requireOpen();
        await cloud.save(Object.fromEntries([...writes].map(([key, value]) => [this.remoteKey(key), value])));
        const updated = new Map(this.entries);
        for (const [key, raw] of writes) this.updateBase(updated, key, raw);
        this.commit(updated);
        report.written = [...writes.keys()];
      }
      if (deletes.length) {
        this.requireOpen();
        await cloud.remove(deletes.map(key => this.remoteKey(key)));
        const updated = new Map(this.entries);
        for (const key of deletes) this.updateBase(updated, key, null);
        this.commit(updated);
        report.deleted = deletes;
      }
      return report;
    });
  }

  /** Inspect the saved remote side without exposing the raw encoded value. */
  conflict(key: string): { cloud: T | undefined } | undefined {
    this.remoteKey(key);
    const raw = this.entries.get(key)?.conflict;
    return raw === undefined ? undefined : { cloud: raw === null ? undefined : this.codec.decode(raw) };
  }

  resolve(key: string, keep: 'local' | 'cloud'): Promise<void> {
    return this.enqueue(() => {
      this.remoteKey(key);
      const entry = this.entries.get(key);
      if (entry?.conflict === undefined || entry.next === undefined) throw new Error('save_conflict_missing');
      const entries = new Map(this.entries);
      if (keep === 'cloud') this.updateBase(entries, key, entry.conflict);
      else entries.set(key, { base: entry.conflict, next: entry.next });
      this.commit(entries);
    });
  }

  /** Prevents further writes from queued syncs and waits for any in-flight operation to settle. */
  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
  }

  private remoteKey(key: string): string {
    validateKey(key);
    const raw = this.prefix + key;
    validateKey(raw);
    return raw;
  }

  private stage(key: string, raw: RawSave): void {
    this.remoteKey(key);
    const entries = new Map(this.entries);
    const entry = entries.get(key);
    if (this.cloud) entries.set(key, { ...entry, base: entry?.base ?? null, next: raw });
    else this.updateBase(entries, key, raw);
    this.commit(entries);
  }

  private updateBase(entries: Map<string, Entry>, key: string, raw: RawSave): void {
    if (raw === null) entries.delete(key);
    else entries.set(key, { base: raw });
  }

  private commit(entries: Map<string, Entry>): void {
    if (entries.size > limits.maxKeys) throw new SaveError('invalid_save');
    try {
      if (entries.size === 0) this.cache?.removeItem(this.cacheKey);
      else this.cache?.setItem(this.cacheKey, JSON.stringify([...entries]));
    } catch (cause) {
      throw new SaveError('cache_failure', { cause });
    }
    this.entries = entries;
  }

  private loadCache(): Map<string, Entry> {
    let raw: string | null | undefined;
    try {
      raw = this.cache?.getItem(this.cacheKey);
    } catch (cause) {
      throw new SaveError('cache_failure', { cause });
    }
    if (raw == null) return new Map();
    try {
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries) || entries.length > limits.maxKeys) throw new Error('invalid_entries');
      const result = new Map<string, Entry>();
      for (const item of entries) {
        if (!Array.isArray(item) || item.length !== 2 || !isEntry(item[1]) || result.has(item[0])) {
          throw new Error('invalid_entry');
        }
        this.remoteKey(item[0]);
        result.set(item[0], item[1]);
      }
      return result;
    } catch (cause) {
      throw new SaveError('corrupt_save', { cause });
    }
  }

  private requireOpen(): void {
    if (this.closed) throw new Error('save_session_closed');
  }

  private enqueue<R>(operation: () => R | Promise<R>): Promise<R> {
    const result = this.queue.then(() => {
      this.requireOpen();
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
