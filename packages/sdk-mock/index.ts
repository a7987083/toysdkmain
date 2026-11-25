import {
  type Board, type ChargeUnlockResp, type KV, type Period, type RankItem, type RankQuery,
  type ToyContainerState, type ToyPlayerState, type ToySDK, type Unsubscribe,
  promiseMethods, subscriptionMethods, validateItems, validateKey, validateRank, validateScore,
} from '../sdk-contract/index.js';

export class MockStore {
  readonly saves = new Map<string, Map<string, string>>();
  readonly ranks = new Map<string, Map<string, number>>();
}

type Failure = { type: string; code?: number };
type Fixtures = Partial<Pick<ToySDK,
  'getAuthorProfile' | 'getAuthorVideos' | 'getAuthorVideoRange' | 'getAuthorRelation' |
  'getVideoUserActions' | 'getAnnualReport' | 'getQrCode' | 'requestCamera' | 'requestMicrophone'>>;

export interface MockOptions {
  simulatedIdentity?: boolean;
  environment?: 'app' | 'web' | 'preview' | 'external';
  consent?: boolean;
  clock?: () => number;
  fixtures?: Fixtures;
  failures?: Partial<Record<keyof ToySDK, Failure | 'pending'>>;
  charge?: ChargeUnlockResp;
  safety?: Awaited<ReturnType<ToySDK['checkInputSafety']>>;
  deletedShared?: ReadonlySet<string>;
}

const appOnly = new Set<keyof ToySDK>([
  'saveImageToAlbum', 'share', 'sharePicture', 'closeBrowser', 'onPageClose',
  'onContainerChange', 'getContainerState', 'setContainerMode',
  'onPlayerChange', 'getPlayerState', 'setPlayerState',
]);
const chargeMethods = new Set<keyof ToySDK>(['getChargeUnlock', 'openChargePanel', 'onChargeUnlockChange']);
const knownMethods = new Set<string>([...promiseMethods, ...subscriptionMethods]);

function fail(type: string, code?: number): never {
  throw Object.assign(new Error(type), { type, code });
}

function mockPeriodKey(period: Period, now: number): string {
  if (period === 'all') return 'all';
  // The mock uses Shanghai calendar periods and Monday-start weeks.
  const date = new Date(now + 8 * 3600_000);
  if (period === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, period === 'month' ? 7 : 10);
}

function subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export class MockSDK implements ToySDK {
  private readonly chargeListeners = new Set<(result: ChargeUnlockResp) => void>();
  private readonly containerListeners = new Set<(state: ToyContainerState) => void>();
  private readonly playerListeners = new Set<(state: ToyPlayerState) => void>();
  private readonly closeListeners = new Set<() => void>();
  private charge: ChargeUnlockResp;
  private closed = false;
  private container: ToyContainerState = {
    deviceType: 'phone', viewport: { width: 390, height: 844 }, orientation: 'portrait', immersive: false,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, changedFields: [],
  };
  private playerState: ToyPlayerState = {
    position: 0, duration: 0, playing: false, muted: false, rate: 0, timestamp: 0, changedFields: [],
  };

  constructor(
    private readonly store: MockStore,
    private readonly toy: string,
    private player: string | null,
    private readonly allowedShared: ReadonlySet<string> = new Set(),
    private readonly options: MockOptions = {},
  ) {
    this.charge = options.charge ?? { status: 'unsupported' };
  }

  private supported(name: string): boolean {
    const env = this.options.environment ?? 'web';
    if (!knownMethods.has(name) || (env !== 'app' && appOnly.has(name as keyof ToySDK))) return false;
    if (env === 'preview' && (name === 'getAnnualReport' || chargeMethods.has(name as keyof ToySDK))) return false;
    if (env === 'external' && ['getAnnualReport', 'getAuthorRelation', 'getVideoUserActions'].includes(name)) return false;
    return true;
  }

  private assertSupported(method: keyof ToySDK): void {
    if (!this.supported(method)) fail('unsupported');
  }

  private async check(method: keyof ToySDK): Promise<void> {
    this.assertSupported(method);
    const failure = this.options.failures?.[method];
    if (failure === 'pending') await new Promise<never>(() => {});
    else if (failure) fail(failure.type, failure.code);
  }

  switchPlayer(player: string | null): void { this.player = player; }

  private user(requireConsent = false): string {
    if (!this.player) fail('not_logged_in');
    if (requireConsent && this.options.consent === false) fail('user_denied');
    return this.player;
  }

  private bucket(scope: string): Map<string, string> {
    const key = JSON.stringify([scope, this.user()]);
    let bucket = this.store.saves.get(key);
    if (!bucket) {
      bucket = new Map();
      this.store.saves.set(key, bucket);
    }
    return bucket;
  }

  private shared(id: string): string {
    if (this.options.deletedShared?.has(id)) fail('not_found');
    if (!this.allowedShared.has(id)) fail('no_permission');
    return 'shared:' + id;
  }

  private read(scope: string, keys?: string[]): KV {
    keys?.forEach(validateKey);
    return Object.fromEntries([...this.bucket(scope)].filter(([key]) => !keys?.length || keys.includes(key)));
  }

  private write(scope: string, items: KV): void {
    validateItems(items);
    const bucket = this.bucket(scope);
    if (new Set([...bucket.keys(), ...Object.keys(items)]).size > 128) fail('invalid_param');
    for (const [key, value] of Object.entries(items)) bucket.set(key, value);
  }

  private remove(scope: string, keys: string[]): void {
    keys.forEach(validateKey);
    const bucket = this.bucket(scope);
    keys.forEach(key => bucket.delete(key));
  }

  async isSupport(name: string): Promise<boolean> {
    await this.check('isSupport');
    return this.supported(name);
  }

  async getUserProfile() {
    await this.check('getUserProfile');
    const nickname = this.user(true);
    return { avatar: '', nickname, ...(this.options.simulatedIdentity ? { toyOpenId: 'mock:' + nickname } : {}) };
  }

  async getCloudStorage(keys?: string[]) { await this.check('getCloudStorage'); return this.read('toy:' + this.toy, keys); }
  async setCloudStorage(items: KV) { await this.check('setCloudStorage'); this.write('toy:' + this.toy, items); }
  async removeCloudStorage(keys: string[]) { await this.check('removeCloudStorage'); this.remove('toy:' + this.toy, keys); }
  async getSharedStorage(id: string, keys?: string[]) { await this.check('getSharedStorage'); return this.read(this.shared(id), keys); }
  async setSharedStorage(id: string, items: KV) { await this.check('setSharedStorage'); this.write(this.shared(id), items); }
  async removeSharedStorage(id: string, keys: string[]) { await this.check('removeSharedStorage'); this.remove(this.shared(id), keys); }

  private now(): number { return this.options.clock?.() ?? Date.now(); }

  private board(board: Board = 1, period: Period = 'all', now = this.now()): Map<string, number> {
    const key = JSON.stringify([this.toy, board, period, mockPeriodKey(period, now)]);
    let scores = this.store.ranks.get(key);
    if (!scores) {
      scores = new Map();
      this.store.ranks.set(key, scores);
    }
    return scores;
  }

  async submitScore(req: { board?: Board; score: number }) {
    await this.check('submitScore');
    validateRank(req);
    validateScore(req.score);
    const player = this.user(true);
    const now = this.now();
    for (const period of ['all', 'month', 'week', 'day'] as const) {
      const scores = this.board(req.board, period, now);
      const previous = scores.get(player);
      if (previous === undefined || req.score > previous) {
        scores.delete(player);
        scores.set(player, req.score);
      }
    }
    return { score: this.board(req.board, 'all', now).get(player)! };
  }

  private sorted(req: RankQuery) {
    validateRank(req);
    return [...this.board(req.board, req.period)].sort((a, b) => b[1] - a[1]);
  }

  async getRankList(req: RankQuery & { limit?: number } = {}): Promise<RankItem[]> {
    await this.check('getRankList');
    const limit = req.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1) fail('invalid_param');
    return this.sorted(req).slice(0, Math.min(limit, 100))
      .map(([nickname, score], index) => ({ nickname, score, rank: index + 1, avatar: '' }));
  }

  async getMyRank(req: RankQuery = {}) {
    await this.check('getMyRank');
    const player = this.user();
    const rows = this.sorted(req);
    const index = rows.findIndex(([name]) => name === player);
    return { ranked: index >= 0, rank: index + 1, score: rows[index]?.[1] ?? 0 };
  }

  async navigate(_req: Parameters<ToySDK['navigate']>[0]) { await this.check('navigate'); }
  async share(_req: Parameters<ToySDK['share']>[0]) { await this.check('share'); }
  async sharePicture(_req: Parameters<ToySDK['sharePicture']>[0]) { await this.check('sharePicture'); }
  async saveImageToAlbum(_req: Parameters<ToySDK['saveImageToAlbum']>[0]) {
    await this.check('saveImageToAlbum');
    return { localPath: 'mock://album/image' };
  }

  async closeBrowser() {
    await this.check('closeBrowser');
    if (this.closed) return;
    this.closed = true;
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    listeners.forEach(listener => listener());
  }

  async getQrCode(req?: Parameters<ToySDK['getQrCode']>[0]) {
    await this.check('getQrCode');
    const fixture = this.options.fixtures?.getQrCode;
    if (!fixture) return fail('fixture_unavailable');
    return fixture(req);
  }

  async getAuthorProfile() {
    await this.check('getAuthorProfile');
    return this.options.fixtures?.getAuthorProfile?.() ?? { status: 'unavailable' } as const;
  }

  async getAuthorVideos(req: Parameters<ToySDK['getAuthorVideos']>[0]): ReturnType<ToySDK['getAuthorVideos']> {
    await this.check('getAuthorVideos');
    return this.options.fixtures?.getAuthorVideos?.(req) ?? { status: 'unavailable', items: [] };
  }

  async getAuthorVideoRange(req?: Parameters<ToySDK['getAuthorVideoRange']>[0]) {
    await this.check('getAuthorVideoRange');
    return this.options.fixtures?.getAuthorVideoRange?.(req) ?? { items: [], hasMore: false };
  }

  async getAuthorRelation() {
    await this.check('getAuthorRelation');
    return this.options.fixtures?.getAuthorRelation?.() ?? { status: this.player ? 'unavailable' : 'unauthorized' } as const;
  }

  async getVideoUserActions(req: Parameters<ToySDK['getVideoUserActions']>[0]): ReturnType<ToySDK['getVideoUserActions']> {
    await this.check('getVideoUserActions');
    return this.options.fixtures?.getVideoUserActions?.(req) ?? { status: this.player ? 'unavailable' : 'unauthorized', items: [] };
  }

  async getAnnualReport(req: Parameters<ToySDK['getAnnualReport']>[0]) {
    await this.check('getAnnualReport');
    this.user(true);
    return this.options.fixtures?.getAnnualReport?.(req) ?? fail('fixture_unavailable');
  }

  async getChargeUnlock(_req: Parameters<ToySDK['getChargeUnlock']>[0]): Promise<ChargeUnlockResp> {
    await this.check('getChargeUnlock');
    return this.player ? structuredClone(this.charge) : { status: 'unauthorized' };
  }

  async openChargePanel(_req: Parameters<ToySDK['openChargePanel']>[0]) {
    await this.check('openChargePanel');
    this.user();
    if (this.charge.status === 'unsupported') fail('unsupported');
  }

  onChargeUnlockChange(listener: Parameters<ToySDK['onChargeUnlockChange']>[0]): Unsubscribe {
    this.assertSupported('onChargeUnlockChange');
    return subscribe(this.chargeListeners, listener);
  }

  simulateChargeResult(result: ChargeUnlockResp): void {
    if (!this.player || result.status === 'unavailable') return;
    const previous = this.charge;
    this.charge = structuredClone(result);
    if (previous.status !== result.status
      || (previous.status === 'ok' && result.status === 'ok' && previous.data.unlocked !== result.data.unlocked)) {
      this.chargeListeners.forEach(listener => listener(structuredClone(result)));
    }
  }

  async requestCamera(options?: Parameters<ToySDK['requestCamera']>[0]) {
    await this.check('requestCamera');
    return this.options.fixtures?.requestCamera?.(options) ?? fail('fixture_unavailable');
  }

  async requestMicrophone() {
    await this.check('requestMicrophone');
    return this.options.fixtures?.requestMicrophone?.() ?? fail('fixture_unavailable');
  }

  async stopMedia(stream: MediaStream) {
    await this.check('stopMedia');
    stream.getTracks().forEach(track => track.stop());
  }

  async getContainerState() {
    await this.check('getContainerState');
    return structuredClone({ ...this.container, changedFields: [] });
  }

  onContainerChange(listener: Parameters<ToySDK['onContainerChange']>[0]): Unsubscribe {
    this.assertSupported('onContainerChange');
    listener(structuredClone({ ...this.container, changedFields: ['deviceType', 'viewport', 'orientation', 'immersive', 'safeArea'] }));
    return subscribe(this.containerListeners, listener);
  }

  simulateContainer(state: Omit<ToyContainerState, 'changedFields'>): void {
    const keys = ['deviceType', 'viewport', 'orientation', 'immersive', 'safeArea'] as const;
    const changedFields = keys.filter(key => JSON.stringify(this.container[key]) !== JSON.stringify(state[key]));
    if (!changedFields.length) return;
    this.container = structuredClone({ ...state, changedFields });
    this.containerListeners.forEach(listener => listener(structuredClone(this.container)));
  }

  async setContainerMode(req: Parameters<ToySDK['setContainerMode']>[0]) {
    await this.check('setContainerMode');
    const orientation = req.orientation === 'auto' ? this.container.orientation : req.orientation ?? this.container.orientation;
    const immersive = req.immersive ?? this.container.immersive;
    if (this.container.deviceType === 'phone' && orientation === 'landscape' && !immersive) fail('invalid_param');
    this.simulateContainer({ ...this.container, orientation, immersive });
  }

  async getPlayerState() {
    await this.check('getPlayerState');
    return { ...this.playerState, changedFields: [] };
  }

  onPlayerChange(listener: Parameters<ToySDK['onPlayerChange']>[0]): Unsubscribe {
    this.assertSupported('onPlayerChange');
    listener({ ...this.playerState, changedFields: ['position', 'duration', 'playing', 'muted', 'rate'] });
    return subscribe(this.playerListeners, listener);
  }

  async setPlayerState(req: Parameters<ToySDK['setPlayerState']>[0]) {
    await this.check('setPlayerState');
    const playing = req.playing ?? this.playerState.playing;
    const next = {
      ...this.playerState, position: req.position ?? this.playerState.position,
      muted: req.muted ?? this.playerState.muted, playing, rate: playing ? 1 : 0, timestamp: this.now(),
    };
    const keys = ['position', 'duration', 'playing', 'muted', 'rate'] as const;
    const changedFields = keys.filter(key => next[key] !== this.playerState[key]);
    this.playerState = { ...next, changedFields };
    if (changedFields.length) this.playerListeners.forEach(listener => listener(structuredClone(this.playerState)));
  }

  onPageClose(listener: () => void): Unsubscribe {
    this.assertSupported('onPageClose');
    return this.closed ? () => {} : subscribe(this.closeListeners, listener);
  }

  async checkInputSafety(_req: Parameters<ToySDK['checkInputSafety']>[0]): ReturnType<ToySDK['checkInputSafety']> {
    await this.check('checkInputSafety');
    this.user();
    return this.options.safety ?? { status: 'unavailable', passed: false };
  }
}


/** An explicit test wrapper. A fault can invoke the real mock operation before failing to model partial success. */
export function withMockFaults(sdk: Partial<ToySDK>, faults: Partial<Record<keyof ToySDK, (proceed: () => unknown, args: unknown[]) => unknown>>): Partial<ToySDK> {
  return new Proxy(sdk, {
    get(target, name, receiver) {
      const method = Reflect.get(target, name, receiver);
      if (typeof method !== 'function') return method;
      const fault = typeof name === 'string' && knownMethods.has(name) ? faults[name as keyof ToySDK] : undefined;
      return (...args: unknown[]) => {
        const proceed = () => Reflect.apply(method, target, args);
        return fault ? fault(proceed, args) : proceed();
      };
    },
  });
}
