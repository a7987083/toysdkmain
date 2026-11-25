import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChargeAccess, GameLeaderboard, GameLifecycle, GameStorage, GameViewport, MockSDK, MockStore,
  SdkDiagnostics, ToyAdapter, ToyRuntime, ToySession, toyCloud, withMockFaults,
} from '../dist/index.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key) };
};
const schema = { version: 1, validate: value => Number.isInteger(value?.level) };
const mock = () => new MockSDK(new MockStore(), 'game', 'player-a', new Set(), { simulatedIdentity: true });

test('runtime shares initialization and capability probes and invalidates disposed adapters', async () => {
  let probes = 0;
  const runtime = new ToyRuntime({ sdk: { isSupport: async () => { probes++; return true; }, getRankList: async () => [] } });
  const first = runtime.initialize();
  assert.equal(runtime.initialize(), first);
  const adapter = await first;
  assert.equal(await runtime.initialize(), adapter);
  assert.deepEqual(await Promise.all([runtime.supports('getRankList'), runtime.supports('getRankList')]), [true, true]);
  assert.equal(probes, 1);
  await runtime.dispose();
  await assert.rejects(adapter.ranks(), { type: 'disposed' });
  assert.notEqual(await runtime.initialize(), adapter);
  await runtime.dispose();
});

test('official runtime has no mock fallback and can recover from missing bridge and delayed SDK injection', async () => {
  const runtime = new ToyRuntime({ timeoutMs: 15 });
  try {
    delete globalThis.toy;
    await assert.rejects(runtime.initialize(), { type: 'initialization_timeout' });
    assert.equal(runtime.state, 'failed');
    globalThis.toy = {};
    await assert.rejects(runtime.initialize(), { type: 'bridge_unavailable' });
    delete globalThis.toy;
    const initializing = runtime.initialize();
    globalThis.toy = mock();
    assert.equal((await initializing).diagnostics().source, 'window.toy');
  } finally {
    await runtime.dispose();
    delete globalThis.toy;
  }
});

test('JavaScript callers cannot cross API groups, invoke internal methods, or pass malformed arguments', async () => {
  let calls = 0;
  const touch = () => { calls++; };
  const adapter = new ToyAdapter({ reportAction: touch, onPageClose: touch, navigate: touch,
    getUserProfile: touch, getCloudStorage: touch, getVideoUserActions: touch, isSupport: touch });
  for (const method of ['reportAction', 'constructor', 'onPageClose']) await assert.rejects(adapter.call(method), { type: 'invalid_param' });
  assert.throws(() => adapter.subscribe('getUserProfile', touch), { type: 'invalid_param' });
  await assert.rejects(adapter.supports('reportAction'), { type: 'invalid_param' });
  await assert.rejects(adapter.call('isSupport', 'reportAction'), { type: 'invalid_param' });
  await assert.rejects(adapter.call('getUserProfile', 1), { type: 'invalid_param' });
  await assert.rejects(adapter.call('getCloudStorage', Array(2)), { type: 'invalid_param' });
  await assert.rejects(adapter.call('getVideoUserActions', { aids: Array(1) }), { type: 'invalid_param' });
  await assert.rejects(adapter.call('navigate', { type: 'toy', id: 'x', extra: { id: 1 } }), { type: 'invalid_param' });
  assert.equal(calls, 0);
});

test('hung requests retain default capacity and logical cancellation reports unknown writes', async () => {
  const upstream = deferred();
  const adapter = new ToyAdapter({ getRankList: () => upstream.promise }, { timeoutMs: 10 });
  await Promise.all(Array.from({ length: 16 }, () => assert.rejects(adapter.ranks(), { type: 'timeout' })));
  assert.equal(adapter.diagnostics().pending, 16);
  assert.equal(adapter.diagnostics().waiting, 0);
  await assert.rejects(adapter.ranks(), { type: 'busy' });
  upstream.resolve([]);
  await tick();
  assert.equal(adapter.diagnostics().pending, 0);
  const write = deferred();
  const controller = new AbortController();
  const saving = new ToyAdapter({ setCloudStorage: () => write.promise });
  const request = saving.callWithSignal(controller.signal, 'setCloudStorage', { value: 'x' });
  controller.abort();
  await assert.rejects(request, { type: 'cancelled', outcome: 'unknown' });
  assert.equal(saving.diagnostics().pending, 1);
  write.resolve();
  await tick();
  assert.equal(saving.diagnostics().pending, 0);
});

test('session generations suppress late profile, cloud and charge results', async () => {
  const fixture = mock();
  const oldProfile = deferred();
  const oldCharge = deferred();
  const oldLoad = deferred();
  let writes = 0;
  const adapter = new ToyAdapter(withMockFaults(fixture, {
    getUserProfile: proceed => profiles++ === 1 ? oldProfile.promise : proceed(),
    getChargeUnlock: () => oldCharge.promise,
    getCloudStorage: () => oldLoad.promise,
    setCloudStorage: () => { writes++; },
  }));
  let profiles = 0;
  const session = new ToySession(adapter);
  await session.refresh();
  const first = session.cacheIdentity();
  const storage = new GameStorage({ namespace: 'rpg', schema, cache: memory(), session: session.storage() });
  await storage.put('main', { level: 1 });
  const syncing = storage.sync();
  await tick();
  const charge = new ChargeAccess(adapter, 1200, session);
  const checking = charge.refresh();
  const refresh = session.refresh();
  await tick();
  fixture.switchPlayer('player-b');
  const current = await session.refresh({ supersede: true });
  assert.equal(current.status, 'user');
  assert.notEqual(session.cacheIdentity(), first);
  oldProfile.resolve({ avatar: '', nickname: 'old', toyOpenId: first });
  oldLoad.resolve({});
  // Dispose charge before releasing the shared old fixture.
  charge.dispose();
  oldCharge.resolve({ status: 'ok', data: { unlocked: true } });
  await Promise.all([refresh, checking, assert.rejects(syncing, { type: 'session_changed' })]);
  assert.equal(session.current.profile.nickname, 'player-b');
  assert.equal(charge.unlocked, false);
  assert.throws(() => storage.get('main'), { type: 'session_changed' });
  assert.equal(writes, 0);
});

test('two cache instances coordinate mutation and reject a stale base', async () => {
  const cache = memory();
  let queue = Promise.resolve();
  const locks = { request: (_key, work) => { const result = queue.then(work); queue = result.catch(() => {}); return result; } };
  const options = { namespace: 'rpg', schema, session: { mode: 'guest' }, cache, locks };
  const a = new GameStorage(options);
  const b = new GameStorage(options);
  const first = a.put('a', { level: 1 });
  const second = assert.rejects(b.put('b', { level: 2 }), { type: 'cache_changed' });
  await Promise.all([first, second]);
  await b.reloadCache();
  await b.put('b', { level: 2 });
  assert.deepEqual(b.get('a'), { level: 1 });
});

test('cache errors leave known pending saves and remote outcomes recoverable', async () => {
  const base = memory();
  const cloud = toyCloud(new ToyAdapter(mock()));
  let writes = 0;
  const cache = { ...base, setItem: (key, value) => {
    if (++writes === 3) throw Error('quota');
    return base.setItem(key, value);
  } };
  const options = { namespace: 'rpg', schema, cache, session: { mode: 'cloud', playerKey: 'a', cloud } };
  const a = new GameStorage(options);
  await a.put('main', { level: 3 });
  await assert.rejects(a.sync(), error => error.report.written.includes('main') && error.cause.type === 'cache_failure');
  const b = new GameStorage(options);
  assert.deepEqual(b.pending(), ['main']);
  await b.sync();
  assert.deepEqual(b.pending(), []);
  const backup = b.exportSlot('main');
  assert.equal(b.measure({ level: 3 }).used, Buffer.byteLength(backup));
  await b.importSlot('other', backup);
  await assert.rejects(async () => b.importSlot('other', backup.slice(0, -1)), { type: 'corrupt_save' });
});

test('a timed out leaderboard submission remains unknown on reload and is not resent', async () => {
  let submissions = 0;
  const request = deferred();
  const options = { playerKey: 'a', gameKey: 'g', storage: memory() };
  const adapter = new ToyAdapter({ submitScore: () => { submissions++; return request.promise; } }, { timeoutMs: 10 });
  const leaderboard = new GameLeaderboard(adapter, 1, options);
  await assert.rejects(leaderboard.submitSettlement('round', 2), { type: 'timeout', outcome: 'unknown' });
  const restored = new GameLeaderboard(adapter, 1, options);
  assert.equal(restored.settlement('round'), 'unknown');
  await assert.rejects(restored.submitSettlement('round', 2), { type: 'operation_unknown' });
  assert.equal(submissions, 1);
  request.resolve({ score: 2 });
});

test('a container event wins over a delayed snapshot and bad dimensions stay outside the game', async () => {
  const snapshot = deferred();
  let listener;
  const adapter = new ToyAdapter({
    isSupport: async () => true, getContainerState: () => snapshot.promise,
    onContainerChange: callback => { listener = callback; return () => {}; },
  });
  const layouts = [];
  const off = new GameViewport(adapter, null).watch(layout => layouts.push(layout));
  await tick();
  const state = { deviceType: 'phone', viewport: { width: 800, height: 390 }, orientation: 'landscape', immersive: true,
    safeArea: { top: 0, right: 1, bottom: 2, left: 3 }, changedFields: ['future-compatible-field'] };
  listener({ ...state, safeArea: { ...state.safeArea, top: NaN } });
  listener(state);
  snapshot.resolve({ ...state, viewport: { width: 390, height: 800 }, orientation: 'portrait' });
  await tick();
  off();
  assert.deepEqual(layouts.map(item => item.orientation), ['landscape']);
});

test('dispose releases lifecycle even when start never settles', async () => {
  const initializing = deferred();
  let received;
  let cleaned = 0;
  const game = new GameLifecycle({}, { start(_config, signal) { received = signal; return initializing.promise; },
    dispose() { cleaned++; } }, null, 20);
  const start = assert.rejects(game.start(), /game_disposed/);
  await tick();
  await game.dispose();
  await start;
  assert.equal(received.aborted, true);
  assert.equal(game.state, 'disposed');
  assert.equal(cleaned, 1);
  initializing.resolve();
});

test('late media gets one cleanup and diagnostics exclude exception details and bound entry count', async () => {
  const telemetry = new SdkDiagnostics(2);
  const pending = deferred();
  let stopped = 0;
  let cleanup = 0;
  const adapter = new ToyAdapter({
    requestCamera: () => pending.promise,
    stopMedia: async () => { cleanup++; throw new Error('secret-token'); },
    getRankList: () => { throw Object.assign(new Error('private profile'), { code: 307044 }); },
  }, { diagnostics: telemetry });
  const request = assert.rejects(adapter.call('requestCamera'), { type: 'disposed' });
  await adapter.dispose();
  await request;
  pending.resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await tick();
  assert.equal(stopped, 1);
  assert.equal(cleanup, 1);
  const other = new ToyAdapter({ getRankList: () => { throw Object.assign(new Error('private profile'), { code: 307044 }); } }, { diagnostics: telemetry });
  await assert.rejects(other.ranks(), { category: 'rate_limited' });
  const report = telemetry.report();
  assert.equal(report.entries.length, 2);
  assert.equal(report.counters.rate_limited, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret-token|private profile/);
});

test('failed bridge probe and timed out lifecycle initialization can be retried safely', async () => {
  let connected = false;
  const runtime = new ToyRuntime({ verifyBridge: true, sdk: { isSupport: async () => {
    if (!connected) throw { type: 'network_error', code: 42 };
    return false;
  } } });
  await assert.rejects(runtime.initialize(), { type: 'bridge_unavailable', code: 42 });
  connected = true;
  await runtime.initialize();
  await runtime.dispose();

  const late = deferred();
  let starts = 0;
  let rollbacks = 0;
  const game = new GameLifecycle({}, { rollbackStart() { rollbacks++; }, start() { if (++starts === 1) return late.promise; } }, null, 10);
  await assert.rejects(game.start(), /game_hook_timeout/);
  await assert.rejects(game.start(), /game_hook_pending/);
  late.resolve();
  await tick();
  await game.start();
  assert.equal(starts, 2);
  assert.equal(rollbacks, 1);
  await game.dispose();
});

test('an older client protects a newer known save envelope from replacement', async () => {
  const cache = memory();
  const options = { namespace: 'rpg', cache, session: { mode: 'guest' } };
  const latest = new GameStorage({ ...options, schema: { ...schema, version: 2 } });
  await latest.put('main', { level: 3 });
  const older = new GameStorage({ ...options, schema });
  await assert.rejects(older.put('main', { level: 2 }), { type: 'unsupported_version' });
  assert.deepEqual(latest.get('main'), { level: 3 });
});
