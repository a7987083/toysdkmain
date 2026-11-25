import { ToyKitError, type ToyAdapter } from '../sdk-adapter/index.js';
import type { ToySession } from '../sdk-session/index.js';
import { validateRank, validateScore, type Board, type RankQuery } from '../sdk-contract/index.js';

export type SettlementState = 'pending' | 'confirmed' | 'unknown' | 'failed';
type Receipt = { score: number; state: SettlementState; at: number; confirmedScore?: number };
export interface SettlementOptions {
  gameKey: string;
  playerKey: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  checkSession?: () => void;
  retentionMs?: number;
  locks?: Pick<LockManager, 'request'>;
}

export class GameLeaderboard {
  private readonly lists = new Map<string, ReturnType<ToyAdapter['ranks']>>();
  private readonly personal = new Map<string, ReturnType<ToyAdapter['myRank']>>();
  private receipts = new Map<string, Receipt>();
  private readonly inFlight = new Map<string, { score: number; result: Promise<{ score: number }> }>();
  private readonly key?: string;
  private readonly retention: number;

  constructor(private readonly adapter: ToyAdapter, private readonly board: Board = 1, private readonly options?: SettlementOptions) {
    validateRank({ board });
    this.retention = options?.retentionMs ?? 7 * 86_400_000;
    if (options) {
      if (!options.gameKey || !options.playerKey || !Number.isSafeInteger(this.retention) || this.retention < 1) {
        throw new Error('invalid_settlement_store');
      }
      this.key = 'toy-settlements:' + JSON.stringify([options.gameKey, options.playerKey, board]);
      this.load();
    }
  }

  static forSession(adapter: ToyAdapter, board: Board, session: ToySession,
    options: Omit<SettlementOptions, 'playerKey' | 'checkSession'>): GameLeaderboard {
    return new GameLeaderboard(adapter, board, { ...options, playerKey: session.cacheIdentity(), checkSession: session.scope() });
  }

  list(options: Omit<RankQuery, 'board'> & { limit?: number } = {}) {
    this.options?.checkSession?.();
    const key = JSON.stringify([options.period ?? 'all', options.limit]);
    const pending = this.lists.get(key);
    if (pending) return pending;
    const result = this.adapter.ranks({ ...options, board: this.board }).then(rows => {
      this.options?.checkSession?.();
      return rows;
    }).finally(() => this.lists.delete(key));
    this.lists.set(key, result);
    return result;
  }

  async mine(period?: RankQuery['period']) {
    this.options?.checkSession?.();
    const key = period ?? 'all';
    const pending = this.personal.get(key);
    if (pending) return pending;
    const result = this.adapter.myRank({ period, board: this.board }).then(rank => {
      this.options?.checkSession?.();
      return rank;
    }).finally(() => this.personal.delete(key));
    this.personal.set(key, result);
    return result;
  }

  diagnostics() {
    this.options?.checkSession?.();
    return { persistence: this.options ? 'cache' : 'memory', pending: this.inFlight.size,
      uncertain: [...this.receipts.values()].filter(entry => entry.state === 'unknown').length };
  }

  settlement(id: string): SettlementState | undefined {
    this.options?.checkSession?.();
    if (this.inFlight.has(id)) return 'pending';
    return this.receipts.get(id)?.state;
  }

  async submitSettlement(id: string, score: number): Promise<{ score: number }> {
    if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new Error('invalid_settlement_id');
    validateScore(score);
    this.options?.checkSession?.();
    const existing = this.inFlight.get(id);
    if (existing) {
      if (existing.score !== score) throw new Error('settlement_score_mismatch');
      return existing.result;
    }
    const operation = async () => {
      this.options?.checkSession?.();
      this.load();
      const receipt = this.receipts.get(id);
      if (receipt && receipt.score !== score) throw new Error('settlement_score_mismatch');
      if (receipt?.state === 'confirmed') return { score: receipt.confirmedScore! };
      if (receipt?.state === 'unknown') throw new ToyKitError('operation_unknown', 'submitScore', undefined, undefined, 'unknown');
      const at = Date.now();
      this.store(id, { score, at, state: 'pending' });
      try {
        const result = await this.adapter.submit(score, this.board);
        this.options?.checkSession?.();
        this.store(id, { score, at, state: 'confirmed', confirmedScore: result.score });
        return result;
      } catch (error) {
        const definite = error instanceof ToyKitError && (error.outcome === 'not_sent' || error.outcome === 'rejected');
        try { this.store(id, { score, at, state: definite ? 'failed' : 'unknown' }); }
        catch (persistError) {
          if (definite) throw error;
          throw new ToyKitError('operation_unknown', 'submitScore', undefined, persistError, 'unknown');
        }
        if (!definite && !(error instanceof ToyKitError && error.outcome === 'unknown')) {
          throw new ToyKitError('operation_unknown', 'submitScore', undefined, error, 'unknown');
        }
        throw error;
      }
    };
    const result = this.coordinate(operation);
    this.inFlight.set(id, { score, result });
    try { return await result; }
    finally { this.inFlight.delete(id); }
  }


  async discardUnknown(id: string): Promise<void> {
    if (this.inFlight.has(id)) throw new Error('settlement_pending');
    await this.coordinate(async () => {
      this.options?.checkSession?.();
      this.load();
      if (this.receipts.get(id)?.state !== 'unknown') throw new Error('settlement_not_unknown');
      const entries = new Map(this.receipts);
      entries.delete(id);
      if (this.options && this.key) this.options.storage.setItem(this.key, JSON.stringify([...entries]));
      this.receipts = entries;
    });
  }

  private coordinate<T>(operation: () => Promise<T>): Promise<T> {
    const locks = this.options?.locks ?? globalThis.navigator?.locks;
    if (this.options && typeof globalThis.Storage === 'function' && this.options.storage instanceof globalThis.Storage && !locks) {
      throw new Error('settlement_lock_unavailable');
    }
    return this.key && locks ? locks.request(this.key, operation) as Promise<T> : operation();
  }

  private load(): void {
    if (!this.options || !this.key) return;
    const raw = this.options.storage.getItem(this.key);
    const values: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 256) throw new Error('invalid_settlement_store');
    const restored = new Map<string, Receipt>();
    for (const [id, receipt] of values) {
      if (typeof id !== 'string' || !id.length || id.length > 256 || restored.has(id) || !receipt
        || !Number.isSafeInteger(receipt.at) || !['pending', 'confirmed', 'unknown', 'failed'].includes(receipt.state)) {
        throw new Error('invalid_settlement_store');
      }
      validateScore(receipt.score);
      if (receipt.state === 'confirmed') validateScore(receipt.confirmedScore);
      if (receipt.state === 'unknown' || receipt.state === 'pending' || receipt.at + this.retention >= Date.now()) {
        restored.set(id, { ...receipt, state: receipt.state === 'pending' ? 'unknown' : receipt.state });
      }
    }
    this.receipts = restored;
  }

  private store(id: string, receipt: Receipt): void {
    const entries = new Map(this.receipts);
    entries.set(id, receipt);
    if (entries.size > 256) {
      for (const [key, entry] of entries) {
        if (key !== id && (entry.state === 'confirmed' || entry.state === 'failed')) entries.delete(key);
        if (entries.size <= 256) break;
      }
    }
    if (entries.size > 256) throw new Error('settlement_capacity');
    if (this.options && this.key) this.options.storage.setItem(this.key, JSON.stringify([...entries]));
    this.receipts = entries;
  }
}
