import test from 'node:test';
import assert from 'node:assert/strict';
import { GameLifecycle } from '../dist/game-core/index.js';
import { GameStorage, toyCloud, sharedCloud } from '../dist/game-storage/index.js';
import { ChargeAccess, GameLeaderboard, GameViewport, applySafeArea } from '../dist/game-platform/index.js';
import { ToyAdapter } from '../dist/sdk-adapter/index.js';
import { MockSDK, MockStore } from '../dist/sdk-mock/index.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const schema = { version: 1, validate: value => Number.isInteger(value?.level) };
const cache = () => {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
};
const optionsFor = cache => ({ namespace: 'rpg', schema, cache });
const guest = { mode: 'guest' };
const player = (playerKey, cloud) => ({ mode: 'cloud', playerKey, cloud });

class Visibility extends EventTarget {
  hidden = false;
  setHidden(value) {
    this.hidden = value;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

test('game lifecycle serializes setup and visibility without overriding manual pause', async () => {
  const visibility = new Visibility();
  const calls = [];
  const states = [];
  const game = new GameLifecycle({ scene: 'game' }, {
    start: ({ scene }) => calls.push(scene),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    dispose: () => calls.push('dispose'),
  }, visibility);
  game.onStateChange(state => states.push(state));
  await Promise.all([game.start(), game.start()]);
  visibility.setHidden(true);
  await tick();
  assert.equal(game.state, 'paused');
  await game.pause();
  visibility.setHidden(false);
  await tick();
  assert.equal(game.state, 'paused');
  await game.resume();
  await Promise.all([game.dispose(), game.dispose()]);
  visibility.setHidden(true);
  await tick();
  assert.deepEqual(calls, ['game', 'pause', 'resume', 'dispose']);
  assert.deepEqual(states, ['running', 'paused', 'running', 'disposed']);
  await assert.rejects(game.start(), /game_disposed/);
});

test('guest saves migrate across reloads and are isolated from logged-in cache', async () => {
  const options = optionsFor(cache());
  const first = new GameStorage({ ...options, session: guest });
  const value = { level: 1 };
  const put = first.put('slot', value);
  value.level = 5;
  await put;
  const second = new GameStorage({
    ...options,
    session: guest,
    schema: { version: 2, validate: data => data?.hp === 10, migrations: { 1: data => ({ ...data, hp: 10 }) } },
  });
  assert.deepEqual(second.get('slot'), { level: 1, hp: 10 });
  await assert.rejects(first.put('oversized', { level: 1, data: '汉'.repeat(350) }), { type: 'save_too_large' });
  await assert.rejects(first.sync(), /cloud_session_required/);
  const cloud = toyCloud(new ToyAdapter(new MockSDK(new MockStore(), 'game', 'player')));
  assert.equal(new GameStorage({ ...options, session: player('player', cloud) }).get('slot'), undefined);
});

test('two devices detect conflicting writes, preserve both copies and require explicit resolution', async () => {
  const cloud = toyCloud(new ToyAdapter(new MockSDK(new MockStore(), 'game', 'player')));
  const a = new GameStorage({ ...optionsFor(cache()), session: player('player', cloud) });
  const b = new GameStorage({ ...optionsFor(cache()), session: player('player', cloud) });
  await a.put('slot', { level: 1 });
  assert.deepEqual(await a.sync(), { written: ['slot'], deleted: [], conflicts: [] });
  await b.sync(['slot']);
  await a.put('slot', { level: 2 });
  await a.sync();
  await b.put('slot', { level: 3 });
  assert.deepEqual((await b.sync()).conflicts, ['slot']);
  assert.deepEqual(b.get('slot'), { level: 3 });
  assert.deepEqual(b.conflict('slot'), { cloud: { level: 2 } });
  await b.resolve('slot', 'local');
  await a.put('slot', { level: 4 });
  await a.sync();
  assert.deepEqual((await b.sync()).conflicts, ['slot']);
  await b.resolve('slot', 'cloud');
  assert.deepEqual(b.get('slot'), { level: 4 });
  assert.deepEqual(b.pending(), []);
  await b.remove('slot');
  assert.deepEqual((await b.sync()).deleted, ['slot']);
  await a.sync();
  assert.equal(a.get('slot'), undefined);
});

test('an acknowledged upsert and uncertain delete survive a partial sync failure', async () => {
  const adapter = new ToyAdapter(new MockSDK(new MockStore(), 'game', 'player'));
  const cloud = toyCloud(adapter);
  let removed = 0;
  const interrupted = {
    ...cloud,
    async remove(keys) {
      removed++;
      await cloud.remove(keys);
      throw new Error('transport_failed');
    },
  };
  const options = { ...optionsFor(cache()), session: player('player', interrupted) };
  const first = new GameStorage(options);
  await first.put('old', { level: 1 });
  await first.sync();
  await first.put('new', { level: 2 });
  await first.remove('old');
  await assert.rejects(first.sync(), /transport_failed/);
  await first.close();
  const reopened = new GameStorage(options);
  assert.deepEqual(reopened.pending(), ['old']);
  assert.deepEqual(reopened.get('new'), { level: 2 });
  await reopened.sync();
  assert.deepEqual(reopened.pending(), []);
  assert.equal(removed, 1);
});

test('closing the account session during a read prevents queued cloud writes', async () => {
  let finish;
  let writes = 0;
  const cloud = {
    scope: 'toy',
    load: () => new Promise(resolve => { finish = resolve; }),
    save: async () => { writes++; },
    remove: async () => {},
  };
  const storage = new GameStorage({ ...optionsFor(cache()), session: player('player', cloud) });
  await storage.put('slot', { level: 1 });
  const syncing = storage.sync();
  await tick();
  const closing = storage.close();
  finish({});
  await assert.rejects(syncing, /save_session_closed/);
  await closing;
  assert.equal(writes, 0);
  assert.deepEqual(storage.pending(), ['slot']);
});

test('a corrupted cloud slot is reported and can be explicitly replaced after reading it', async () => {
  const adapter = new ToyAdapter(new MockSDK(new MockStore(), 'game', 'player'));
  const storage = new GameStorage({ ...optionsFor(cache()), session: player('player', toyCloud(adapter)) });
  await adapter.save({ '3_rpg_slot': 'corrupted' });
  await storage.sync(['slot']);
  assert.throws(() => storage.get('slot'), { type: 'corrupt_save' });
  await storage.put('slot', { level: 2 });
  await storage.sync();
  assert.deepEqual(storage.get('slot'), { level: 2 });
});

test('shared storage follows the selected storage ID across authorized Toys', async () => {
  const id = 'st_1234567890abcdef';
  const allowed = new Set([id]);
  const store = new MockStore();
  const a = new ToyAdapter(new MockSDK(store, 'toy-a', 'player', allowed));
  const b = new ToyAdapter(new MockSDK(store, 'toy-b', 'player', allowed));
  const walletA = new GameStorage({ ...optionsFor(cache()), session: player('player', sharedCloud(a, id)) });
  const walletB = new GameStorage({ ...optionsFor(cache()), session: player('player', sharedCloud(b, id)) });
  await walletA.put('slot', { level: 1 });
  await walletA.sync();
  await walletB.sync(['slot']);
  assert.deepEqual(walletB.get('slot'), { level: 1 });
  assert.deepEqual(await a.load(), {});
});

test('charge ignores out-of-order responses and opens the panel in the gesture call stack', async () => {
  const replies = [];
  let opened = false;
  const charge = new ChargeAccess(new ToyAdapter({
    openChargePanel: async () => { opened = true; },
    getChargeUnlock: () => new Promise(resolve => replies.push(resolve)),
  }));
  const opening = charge.openPanel();
  assert.equal(opened, true);
  await opening;
  assert.equal(charge.unlocked, false);
  const first = charge.refresh();
  const second = charge.refresh();
  replies[1]({ status: 'denied' });
  await second;
  replies[0]({ status: 'ok', data: { unlocked: true } });
  assert.equal(await first, 'unavailable');
  assert.equal(charge.unlocked, false);
  const visibility = new Visibility();
  charge.watchVisibility(visibility);
  visibility.setHidden(true);
  assert.equal(replies.length, 2);
  visibility.setHidden(false);
  replies[2]({ status: 'ok', data: { unlocked: true } });
  await tick();
  assert.equal(charge.unlocked, true);
  charge.dispose();
  assert.equal(charge.unlocked, false);
});

test('leaderboard settles once per recent round and accepts zero and negative scores', async () => {
  let calls = 0;
  const leaderboard = new GameLeaderboard(new ToyAdapter({
    submitScore: async ({ board, score }) => {
      assert.equal(board, 3);
      calls++;
      return { score };
    },
  }), 3);
  assert.deepEqual(await Promise.all([leaderboard.submitSettlement('round-1', 0),
    leaderboard.submitSettlement('round-1', 0)]), [{ score: 0 }, { score: 0 }]);
  assert.equal(calls, 1);
  await assert.rejects(leaderboard.submitSettlement('round-1', 5), /settlement_score_mismatch/);
  assert.deepEqual(await leaderboard.submitSettlement('round-2', -1), { score: -1 });
  assert.equal(calls, 2);
});

test('viewport falls back to browser layout, then uses host orientation and CSS safe-area insets', async () => {
  const browser = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 });
  const mock = new MockSDK(new MockStore(), 'toy', 'player', new Set(), { environment: 'app' });
  const viewport = new GameViewport(new ToyAdapter(mock), browser);
  const layouts = [];
  const off = viewport.watch(layout => layouts.push(layout));
  assert.deepEqual(layouts.map(layout => layout.source), ['browser']);
  await tick();
  assert.deepEqual(layouts.map(layout => layout.source), ['browser', 'toy']);
  await viewport.requestMode({ orientation: 'landscape', immersive: true });
  assert.equal(layouts.at(-1).orientation, 'landscape');
  const css = new Map();
  applySafeArea({ setProperty: (key, value) => css.set(key, value) }, layouts[0]);
  assert.equal(css.get('--toy-safe-area-top'), 'env(safe-area-inset-top, 0px)');
  applySafeArea({ setProperty: (key, value) => css.set(key, value) }, layouts.at(-1));
  assert.equal(css.get('--toy-safe-area-top'), '0px');
  const count = layouts.length;
  off();
  browser.dispatchEvent(new Event('resize'));
  await viewport.requestMode({ orientation: 'portrait' });
  assert.equal(layouts.length, count);
});
