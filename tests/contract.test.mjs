import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSDK, MockStore } from '../dist/sdk-mock/index.js';
import { ToyAdapter, ToyKitError } from '../dist/sdk-adapter/index.js';
import { promiseMethods, subscriptionMethods } from '../dist/sdk-contract/index.js';

const hasType = type => error => error instanceof ToyKitError && error.type === type;

test('Mock provides all 37 public methods and exposes environment-specific support', async () => {
  const mock = new MockSDK(new MockStore(), 'toy', 'player', new Set(), { environment: 'preview' });
  const methods = [...promiseMethods, ...subscriptionMethods];
  assert.equal(new Set(methods).size, 37);
  for (const method of methods) assert.equal(typeof mock[method], 'function', method);
  const adapter = new ToyAdapter(mock);
  assert.equal(await adapter.supports('getAnnualReport'), false);
  assert.equal(await adapter.supports('getContainerState'), false);
  assert.equal(await adapter.supports('getRankList'), true);
  await assert.rejects(adapter.call('getAnnualReport', { edition: '2026' }), hasType('unsupported'));
});

test('SDK calls start synchronously and preserve the host receiver', async () => {
  let started = false;
  const sdk = {
    navigate() {
      assert.equal(this, sdk);
      started = true;
      return Promise.resolve();
    },
  };
  const adapter = new ToyAdapter(sdk);
  const navigation = adapter.call('navigate', { type: 'toy', id: 'example' });
  assert.equal(started, true);
  await navigation;
  await assert.rejects(adapter.profile(), hasType('unsupported'));
  assert.throws(() => ToyAdapter.fromWindow(), hasType('sdk_unavailable'));
});

test('window initialization waits for explicit SDK injection within deadline', async () => {
  try {
    const result = ToyAdapter.waitForWindow(100);
    globalThis.toy = { getRankList: async () => [] };
    assert.deepEqual(await (await result).ranks(), []);
  } finally {
    delete globalThis.toy;
  }
  await assert.rejects(ToyAdapter.waitForWindow(0), hasType('sdk_unavailable'));
});

test('payment and moderation reject malformed responses and keep denial explicit', async () => {
  const adapter = new ToyAdapter({
    getChargeUnlock: async () => ({ status: 'ok', data: { unlocked: 'true' } }),
    checkInputSafety: async () => ({ status: 'unavailable', passed: true }),
  });
  await assert.rejects(adapter.call('getChargeUnlock', { minPrice: 1200 }), hasType('invalid_response'));
  await assert.rejects(adapter.call('checkInputSafety', { text: 'nickname' }), hasType('invalid_response'));
  await assert.rejects(adapter.call('checkInputSafety', { text: '汉'.repeat(5462) }), hasType('invalid_param'));
  await assert.rejects(adapter.call('getQrCode'), hasType('unsupported'));
  const mock = new MockSDK(new MockStore(), 'toy', 'player', new Set(), { consent: false });
  await assert.rejects(new ToyAdapter(mock).profile(), hasType('user_denied'));
  assert.deepEqual(await mock.checkInputSafety({ text: 'name' }), { status: 'unavailable', passed: false });
});

test('adapter rejects out-of-scope sharing and keeps large rank limit server-compatible', async () => {
  let used = false;
  const adapter = new ToyAdapter({
    share: async () => { used = true; },
    getRankList: async req => {
      assert.equal(req.limit, 101);
      return [];
    },
  });
  for (const path of ['../other/index.html', 'https://example.org', '%2e%2e/other']) {
    await assert.rejects(adapter.call('share', { path }), hasType('invalid_param'));
  }
  assert.equal(used, false);
  assert.deepEqual(await adapter.ranks({ limit: 101 }), []);
});

test('timeouts keep upstream requests counted and stop late media tracks', async () => {
  let resolveCamera;
  let stopped = 0;
  const sdk = {
    requestCamera: () => new Promise(resolve => { resolveCamera = resolve; }),
    getRankList: async () => [],
  };
  const adapter = new ToyAdapter(sdk, { timeoutMs: 10, maxPending: 1 });
  await assert.rejects(adapter.call('requestCamera'), hasType('timeout'));
  await assert.rejects(adapter.ranks(), hasType('busy'));
  resolveCamera({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, 1);
  assert.deepEqual(await adapter.ranks(), []);
});

test('only explicit reads retry a platform rate limit', async () => {
  const limit = { type: 'http_error', code: 307044 };
  let reads = 0;
  let writes = 0;
  const adapter = new ToyAdapter({
    getCloudStorage: async () => {
      if (++reads === 1) throw limit;
      return {};
    },
    setCloudStorage: async () => { writes++; throw limit; },
  });
  assert.deepEqual(await adapter.readWithBackoff('getCloudStorage'), {});
  assert.equal(reads, 2);
  await assert.rejects(adapter.save({ level: '3' }), error => error.type === 'http_error' && error.code === 307044);
  assert.equal(writes, 1);
});

test('mock periods reset independently and equal scores keep first attainment', async () => {
  let now = Date.parse('2026-11-29T15:59:59Z');
  const options = { clock: () => now };
  const store = new MockStore();
  const a = new MockSDK(store, 'a', 'first', new Set(), options);
  const b = new MockSDK(store, 'a', 'second', new Set(), options);
  await b.submitScore({ score: -1 });
  await a.submitScore({ score: 0 });
  await b.submitScore({ score: 0 });
  assert.deepEqual((await a.getRankList({ period: 'day' })).map(row => row.nickname), ['first', 'second']);
  now += 1000;
  assert.deepEqual(await a.getRankList({ period: 'week' }), []);
  assert.deepEqual(await a.getRankList({ period: 'day' }), []);
  assert.equal((await a.getMyRank({ period: 'month' })).ranked, true);
  assert.deepEqual(await a.submitScore({ score: -2 }), { score: 0 });
  assert.equal((await a.getMyRank({ period: 'day' })).score, -2);
  assert.equal((await a.getMyRank({ board: 2 })).ranked, false);
});

test('mock charging and container events unsubscribe and dispose cleanly', async () => {
  const mock = new MockSDK(new MockStore(), 'toy', 'player', new Set(), {
    environment: 'app', charge: { status: 'ok', data: { unlocked: false } },
  });
  const adapter = new ToyAdapter(mock);
  const events = [];
  const off = adapter.subscribe('onChargeUnlockChange', state => events.push(state));
  await adapter.call('openChargePanel', { minPrice: 1200 });
  assert.deepEqual(events, []);
  mock.simulateChargeResult({ status: 'ok', data: { unlocked: true } });
  mock.simulateChargeResult({ status: 'unavailable' });
  assert.equal(events.length, 1);
  off();
  off();
  let states = 0;
  adapter.subscribe('onContainerChange', () => { states++; });
  await adapter.call('setContainerMode', { orientation: 'landscape', immersive: true });
  assert.equal(states, 2);
  await adapter.dispose();
  await mock.setContainerMode({ orientation: 'portrait' });
  assert.equal(states, 2);
  await assert.rejects(adapter.ranks(), hasType('disposed'));
});

test('identical in-flight score submissions stay blocked after timeout until the SDK settles', async () => {
  let finish;
  const adapter = new ToyAdapter({
    submitScore: () => new Promise(resolve => { finish = resolve; }),
  }, { timeoutMs: 10 });
  await assert.rejects(adapter.submit(10), hasType('timeout'));
  await assert.rejects(adapter.call('submitScore', { score: 10 }), hasType('duplicate_pending'));
  finish({ score: 10 });
  await new Promise(resolve => setImmediate(resolve));
  const retry = adapter.submit(10);
  finish({ score: 10 });
  assert.deepEqual(await retry, { score: 10 });
});

test('author responses preserve documented per-item video status and video statistics', async () => {
  const video = {
    aid: 1, bvid: 'BV17x411w7KC', title: 'Fixture', cover: '', description: '', publishTime: 1, duration: 2,
    stat: { view: 6, like: 0, coin: 0, favorite: 0, share: 0, comment: 0, danmaku: 0 },
    pages: [], pay: { chargingPay: false, paid: false },
  };
  const adapter = new ToyAdapter(new MockSDK(new MockStore(), 'toy', 'player', new Set(), {
    fixtures: {
      getAuthorVideos: async () => ({ status: 'partial', items: [
        { ref: { aid: 1 }, status: 'ok', data: video },
        { ref: { aid: 2 }, status: 'video_invisible' },
      ] }),
    },
  }));
  const result = await adapter.call('getAuthorVideos', { videos: [{ aid: 1 }, { aid: 2 }] });
  assert.equal(result.items[0].data.stat.view, 6);
  assert.equal(result.items[1].status, 'video_invisible');
  assert.equal(result.items[1].data, undefined);
});
