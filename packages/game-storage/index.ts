import { ToyKitError, type ToyAdapter } from '../sdk-adapter/index.js';
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

export type SaveSession = { mode: 'guest'; check?: () => void } | { mode: 'cloud'; playerKey: string; cloud: SaveCloud; check?: () => void };

export interface SaveOptions<T> {
  /** Prefixes cloud keys and separates games sharing the same local origin. */
  namespace: string;
  schema: SaveSchema<T>;
  session: SaveSession;
  /** Pass an explicit Storage instance for a cache and queue durable across reloads. */
  cache?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Shared coordinator for custom durable cache adapters. Browser localStorage defaults to Web Locks. */
  locks?: Pick<LockManager, 'request'>;
}

type RawSave = string | null;
type Entry = Readonly<{ base: RawSave; next?: RawSave; conflict?: RawSave; sent?: string }>;

export interface SyncReport {
  written: string[];
  deleted: string[];
  conflicts: string[];
}

export class SaveSyncError extends Error {
  constructor(readonly report: SyncReport, readonly unknown: readonly string[], cause: unknown) {
    super(cause instanceof Error ? cause.message : 'save_sync_failed', { cause });
    this.name = 'SaveSyncError';
  }
}

const fields = new Set(['base', 'next', 'conflict', 'sent']);
const rawSave = (value: unknown): value is RawSave => value === null || typeof value === 'string';
const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && Object.hasOwn(value, 'base')
  && Object.entries(value).every(([field, raw]) => fields.has(field) && rawSave(raw))
  && (!Object.hasOwn(value, 'conflict') || Object.hasOwn(value, 'next'))
  && (!Object.hasOwn(value, 'sent') || (typeof (value as Entry).sent === 'string' && Object.hasOwn(value, 'next')));

// Only this realm can witness settlement. Evicted and pre-reload IDs remain uncertain.
const pendingWrites = new Set<string>();
const settledWrites = new Set<string>();
function settled(id: string): void {
  pendingWrites.delete(id);
  settledWrites.add(id);
  if (settledWrites.size > 512) settledWrites.delete(settledWrites.values().next().value!);
}

export class CorruptCacheError extends SaveError {
  constructor(cause: unknown, readonly exportOriginal: () => string, readonly resetAfterBackup: () => Promise<void>) {
    super('corrupt_save', { cause });
  }
}

export class GameStorage<T> {
  private readonly codec: SaveCodec<T>;
  private readonly prefix: string;
  private readonly cacheKey: string;
  private readonly cache: SaveOptions<T>['cache'];
  private readonly cloud?: SaveCloud;
  private readonly locks?: Pick<LockManager, 'request'>;
  private readonly browserCache: boolean;
  private cacheRevision: string | null = null;
  private readonly checkSession?: () => void;
  private entries: Map<string, Entry>;
  private syncRequest?: { selection: string; result: Promise<SyncReport> };
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
    this.checkSession = session.check;
    this.cacheKey = 'toygamekit:' + JSON.stringify([
      options.namespace, session.mode,
      ...(session.mode === 'cloud' ? [session.cloud.scope, session.playerKey] : []),
    ]);
    this.cache = options.cache;
    this.browserCache = typeof globalThis.Storage === 'function' && options.cache instanceof globalThis.Storage;
    this.locks = options.locks ?? (this.browserCache ? globalThis.navigator?.locks : undefined);
    this.codec = new SaveCodec(options.schema);
    this.entries = this.loadCache();
  }

  diagnostics() {
    this.requireOpen();
    return { persistence: this.cache ? 'cache' : 'memory', dirty: this.pending().length,
      uncertain: [...this.entries.values()].filter(entry => entry.sent).length };
  }

  get(key: string): T | undefined {
    this.requireOpen();
    this.remoteKey(key);
    const entry = this.entries.get(key);
    const raw = entry?.next !== undefined ? entry.next : entry?.base;
    return raw == null ? undefined : this.codec.decode(raw);
  }

  /** The caller can export even a corrupt slot, then explicitly replace that slot. */
  exportSlot(key: string): string | undefined {
    this.requireOpen();
    this.remoteKey(key);
    const entry = this.entries.get(key);
    return (entry?.next !== undefined ? entry.next : entry?.base) ?? undefined;
  }

  async importSlot(key: string, raw: string): Promise<void> {
    return this.put(key, this.codec.decode(raw));
  }

  /** Measure the exact UTF-8 size of a candidate, including its stored envelope. */
  measure(value: T) { return this.codec.measure(value); }

  /** Reload the authoritative local cache after observing another context's change. */
  reloadCache(): Promise<void> {
    return this.enqueue(() => { this.entries = this.loadCache(); }, false);
  }

  watchCache(listener: () => void, source: Pick<Window, 'addEventListener' | 'removeEventListener'> = globalThis.window) {
    this.requireOpen();
    const handler = (event: Event) => {
      const change = event as StorageEvent;
      if (!this.closed && change.storageArea === this.cache && (change.key === this.cacheKey || change.key === null)) listener();
    };
    if (!source || !this.browserCache) return () => {};
    source.addEventListener('storage', handler);
    const off = () => { source.removeEventListener('storage', handler); this.cacheListeners.delete(off); };
    this.cacheListeners.add(off);
    return off;
  }

  private readonly cacheListeners = new Set<() => void>();

  pending(): string[] {
    this.checkSession?.();
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
    const signature = JSON.stringify(selection ?? null);
    if (this.syncRequest?.selection === signature) return this.syncRequest.result;
    const result = this.enqueue(async () => {
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
        if (entry?.sent && !settledWrites.has(entry.sent)) {
          entries.set(key, { ...entry, conflict: raw });
          report.conflicts.push(key);
        } else if (entry?.next === undefined || entry.next === raw) {
          this.updateBase(entries, key, raw);
        } else if (entry.base !== raw || entry.sent !== undefined) {
          entries.set(key, { ...entry, conflict: raw });
          report.conflicts.push(key);
        } else {
          entries.set(key, { base: raw, next: entry.next });
          if (entry.next === null) deletes.push(key);
          else writes.set(key, entry.next);
        }
      }
      this.commit(entries);
      const send = async (group: Map<string, RawSave>, operation: () => Promise<void>, target: 'written' | 'deleted') => {
        if (!group.size) return;
        this.requireOpen();
        const id = crypto.randomUUID();
        const staged = new Map(this.entries);
        for (const key of group.keys()) staged.set(key, { ...staged.get(key)!, sent: id });
        this.commit(staged);
        const keys = [...group.keys()];
        try {
          pendingWrites.add(id);
          try {
            await operation();
            settled(id);
          } catch (error) {
            if (error instanceof ToyKitError && error.hostSettled) void error.hostSettled.then(() => settled(id));
            else settled(id);
            if (error instanceof ToyKitError && (error.outcome === 'not_sent' || error.outcome === 'rejected')) {
              const unsent = new Map(this.entries);
              for (const key of keys) {
                const { sent: _, ...entry } = unsent.get(key)!;
                unsent.set(key, entry);
              }
              this.commit(unsent);
              throw new SaveSyncError(report, [], error);
            }
            throw error;
          }
          this.requireOpen();
          const observed = await cloud.load(keys.map(key => this.remoteKey(key)));
          this.requireOpen();
          const updated = new Map(this.entries);
          for (const [key, raw] of group) {
            const remoteKey = this.remoteKey(key);
            const actual = Object.hasOwn(observed, remoteKey) ? observed[remoteKey]! : null;
            if (actual === raw) {
              this.updateBase(updated, key, raw);
              report[target].push(key);
            } else {
              updated.set(key, { ...updated.get(key)!, conflict: actual });
              report.conflicts.push(key);
            }
          }
          this.commit(updated);
        } catch (error) {
          const unknown = keys.filter(key => !report[target].includes(key));
          if (error instanceof SaveSyncError) throw error;
          throw new SaveSyncError(report, unknown, error);
        }
      };
      await send(writes, () => cloud.save(Object.fromEntries([...writes].map(([key, value]) => [this.remoteKey(key), value]))), 'written');
      await send(new Map(deletes.map(key => [key, null])), () => cloud.remove(deletes.map(key => this.remoteKey(key))), 'deleted');
      return report;
    }).finally(() => { if (this.syncRequest?.result === result) this.syncRequest = undefined; });
    this.syncRequest = { selection: signature, result };
    return result;
  }

  conflictReason(key: string): 'remote_changed' | 'unknown_commit' | undefined {
    this.requireOpen();
    this.remoteKey(key);
    const entry = this.entries.get(key);
    if (entry?.conflict === undefined) return undefined;
    return entry.sent === undefined ? 'remote_changed' : 'unknown_commit';
  }

  /** Inspect the saved remote side without exposing the raw encoded value. */
  conflict(key: string): { cloud: T | undefined } | undefined {
    this.requireOpen();
    this.remoteKey(key);
    const raw = this.entries.get(key)?.conflict;
    return raw === undefined ? undefined : { cloud: raw === null ? undefined : this.codec.decode(raw) };
  }

  resolve(key: string, keep: 'local' | 'cloud', options: { acceptLateWriteRisk?: boolean } = {}): Promise<void> {
    return this.enqueue(() => {
      this.remoteKey(key);
      const entry = this.entries.get(key);
      if (entry?.conflict === undefined || entry.next === undefined) throw new Error('save_conflict_missing');
      const entries = new Map(this.entries);
      if (entry.sent && pendingWrites.has(entry.sent)) throw new Error('save_write_pending');
      if (entry.sent && !settledWrites.has(entry.sent) && !options.acceptLateWriteRisk) throw new Error('save_write_unverified');
      if (keep === 'cloud') this.updateBase(entries, key, entry.conflict);
      else {
        if (entry.next !== null) this.protectVersion(entry.conflict);
        entries.set(key, { base: entry.conflict, next: entry.next });
      }
      this.commit(entries);
    });
  }

  /** Prevents further writes from queued syncs and waits for any in-flight operation to settle. */
  async close(): Promise<void> {
    this.closed = true;
    for (const off of this.cacheListeners) off();
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
    if (raw !== null) this.protectVersion(entry?.next ?? entry?.base);
    if (this.cloud) entries.set(key, { ...entry, base: entry?.base ?? null, next: raw });
    else this.updateBase(entries, key, raw);
    this.commit(entries);
  }

  private protectVersion(raw: RawSave | undefined): void {
    if (raw == null) return;
    try { this.codec.decode(raw); }
    catch (error) {
      if (error instanceof SaveError && error.type === 'unsupported_version') throw error;
      // Explicit replacement of a corrupted slot is allowed.
    }
  }

  private updateBase(entries: Map<string, Entry>, key: string, raw: RawSave): void {
    if (raw === null) entries.delete(key);
    else entries.set(key, { base: raw });
  }

  private commit(entries: Map<string, Entry>): void {
    if (entries.size > limits.maxKeys) throw new SaveError('invalid_save');
    const revision = entries.size === 0 ? null : JSON.stringify([...entries]);
    try {
      if (revision === this.cacheRevision && this.cache) {
        this.entries = entries;
        return;
      }
      if (revision === null) this.cache?.removeItem(this.cacheKey);
      else this.cache?.setItem(this.cacheKey, revision);
    } catch (cause) {
      throw new SaveError('cache_failure', { cause });
    }
    this.cacheRevision = revision;
    this.entries = entries;
  }

  private loadCache(): Map<string, Entry> {
    let raw: string | null | undefined;
    try {
      raw = this.cache?.getItem(this.cacheKey);
    } catch (cause) {
      throw new SaveError('cache_failure', { cause });
    }
    if (raw == null) { this.cacheRevision = null; return new Map(); }
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
      this.cacheRevision = raw;
      return result;
    } catch (cause) {
      const original = raw;
      let exported = false;
      throw new CorruptCacheError(cause, () => {
        this.requireOpen();
        exported = true;
        return original;
      }, async () => {
        const reset = () => {
          this.requireOpen();
          if (!exported) throw new Error('cache_backup_required');
          if (this.cache?.getItem(this.cacheKey) !== original) throw new SaveError('cache_changed');
          this.cache.removeItem(this.cacheKey);
        };
        if (this.locks) await this.locks.request(this.cacheKey, reset);
        else if (this.browserCache) throw new SaveError('cache_lock_unavailable');
        else reset();
      });
    }
  }

  private requireOpen(): void {
    if (this.closed) throw new Error('save_session_closed');
    this.checkSession?.();
  }

  private enqueue<R>(operation: () => R | Promise<R>, write = true): Promise<R> {
    this.syncRequest = undefined;
    const run = async () => {
      this.requireOpen();
      if (write && this.cache) {
        let latest: string | null;
        try { latest = this.cache.getItem(this.cacheKey); }
        catch (cause) { throw new SaveError('cache_failure', { cause }); }
        if (latest !== this.cacheRevision) throw new SaveError('cache_changed');
      }
      return operation();
    };
    const result = this.queue.then(async () => {
      this.requireOpen();
      if (this.locks && this.cache) return this.locks.request(this.cacheKey, run) as Promise<R>;
      if (write && this.browserCache) throw new SaveError('cache_lock_unavailable');
      return run();
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
