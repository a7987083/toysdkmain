import test from 'node:test';
import assert from 'node:assert/strict';
import { ToyAdapter, ToyRuntime, ToySession, GameStorage, toyCloud, ChargeAccess, GameViewport } from '../dist/index.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const profile = { nickname: 'a', avatar: '', toyOpenId: 'a' };

test('foreground recovers after unknown identity and preserves same-user scopes', async () => {
  let failure = false;
  const session = new ToySession(new ToyAdapter({getUserProfile: async () => {
    if (failure) throw {type: 'network_error'};
    return profile;
  }}));
  const events = new EventTarget();
  session.watchVisibility(events);
  await session.refresh();
  const guard = session.scope();
  failure = true;
  events.dispatchEvent(new Event('visibilitychange'));
  await tick();
  assert.throws(guard);
  failure = false;
  events.dispatchEvent(new Event('visibilitychange'));
  await tick();
  guard();
  session.enterGuest();
  assert.throws(guard);
  session.dispose();
});

test('unrecognized dispatched failure is uncertain, failed validation is unsent', async () => {
  const adapter = new ToyAdapter({submitScore() {throw {type:'future_failure',code:77};}});
  await assert.rejects(adapter.submit(1), {code:77,outcome:'unknown'});
  await assert.rejects(adapter.submit(NaN), {outcome:'not_sent'});
});

test('an older host write fences the slot even if a staged deletion matches the cloud', async () => {
  const late = Promise.withResolvers();
  let calls = 0;
  const adapter = new ToyAdapter({getCloudStorage: async () => ({}),
    setCloudStorage() { calls++; return late.promise; }}, { timeoutMs: 10 });
  const store = new GameStorage({namespace:'g',schema:{version:1,validate:Number.isInteger},
    session:{mode:'cloud',playerKey:'a',cloud:toyCloud(adapter)}});
  await store.put('slot',1);
  await assert.rejects(store.sync());
  await store.remove('slot');
  assert.deepEqual((await store.sync()).conflicts,['slot']);
  await assert.rejects(store.resolve('slot','local'), /pending/);
  late.resolve();
  await tick();
  assert.equal(calls,1);
  await store.resolve('slot','local');
});

test('concurrent and repeated media releases share host failure', async () => {
  let calls = 0;
  const stream = {getTracks:()=>[]};
  const pending = Promise.withResolvers();
  const adapter = new ToyAdapter({requestCamera:async()=>stream,stopMedia(){calls++;return pending.promise;}});
  await adapter.call('requestCamera');
  const releases = Promise.allSettled([adapter.call('stopMedia',stream),adapter.call('stopMedia',stream)]);
  pending.reject({type:'user_denied'});
  assert.deepEqual((await releases).map(x=>x.status),['rejected','rejected']);
  await assert.rejects(adapter.call('stopMedia',stream));
  assert.equal(calls,1);
});

test('capability results can be explicitly refreshed', async () => {
  let allowed = false;
  const runtime = new ToyRuntime({sdk:{getUserProfile: async()=>profile,isSupport:async()=>allowed}});
  assert.equal(await runtime.supports('getUserProfile'),false);
  allowed=true;
  assert.equal(await runtime.supports('getUserProfile',{refresh:true}),true);
  await runtime.dispose();
});

test('a burst during a charge query triggers one trailing query', async () => {
  let calls=0, event;
  const pending=Promise.withResolvers();
  const adapter = new ToyAdapter({getChargeUnlock:()=>++calls===1?pending.promise:Promise.resolve({status:'ok',data:{unlocked:true}}),
    onChargeUnlockChange:cb=>{event=cb;return ()=>{};}});
  const charge=new ChargeAccess(adapter);
  charge.watchVisibility(new EventTarget());
  const check=charge.check();
  for(let i=0;i<20;i++) event({status:'ok',data:{unlocked:true}});
  pending.resolve({status:'ok',data:{unlocked:false}});
  await check;
  await tick();
  assert.equal(charge.current,'unlocked');
  assert.equal(calls,2);
  charge.dispose();
});

test('viewport snapshot is usable while ability probe is unresolved', async () => {
  const never = Promise.withResolvers();
  const state = {deviceType:'phone', viewport:{width:2,height:1},orientation:'landscape',immersive:false,
    safeArea:{top:0,left:0,right:0,bottom:0},changedFields:[]};
  const adapter = new ToyAdapter({getContainerState: async()=>state, onContainerChange:()=>()=>{}, isSupport:()=>never.promise});
  const layouts=[];
  const off=new GameViewport(adapter,null).watch(x=>layouts.push(x));
  await tick();
  off();
  never.resolve(false);
  assert.equal(layouts.length,1);
});

test('unknown settlement can only be removed explicitly', async () => {
  const { GameLeaderboard } = await import('../dist/index.js');
  const board=new GameLeaderboard(new ToyAdapter({submitScore:async()=>{throw {type:'unexpected'};}}));
  await assert.rejects(board.submitSettlement('round',1));
  assert.equal(board.settlement('round'),'unknown');
  await board.discardUnknown('round');
  assert.equal(board.settlement('round'),undefined);
});

test('guest scope expires, parallel profile requests coalesce, unidentifiable users cannot persist', async () => {
  let calls=0;
  const session=new ToySession(new ToyAdapter({getUserProfile:async()=>{calls++;return {...profile,toyOpenId:undefined};}}));
  session.enterGuest();
  const guest=session.storage();
  await Promise.all([session.refresh(),session.refresh()]);
  assert.equal(calls,1);
  assert.throws(guest.check);
  assert.throws(()=>session.storage());
  session.dispose();
});

test('corrupt cache requires explicit backup and compare before reset', () => {
  const cache={getItem:()=>'{bad',removeItem(){this.removed=true;}};
  let failure;
  try { new GameStorage({namespace:'g',schema:{version:1,validate:Number.isInteger},session:{mode:'guest'},cache}); }
  catch(error) { failure=error; }
  return (async()=>{
    await assert.rejects(failure.resetAfterBackup(),/backup_required/);
    assert.equal(failure.exportOriginal(),'{bad');
    await failure.resetAfterBackup();
    assert.equal(cache.removed,true);
  })();
});

test('shared rate limit is an explicit rejection, safe reads can retry, writes never retry', async () => {
  let calls=0;
  const adapter=new ToyAdapter({submitScore:async()=>{calls++;throw {type:'http_error',code:307044};}});
  await assert.rejects(adapter.submit(0),{category:'rate_limited',outcome:'rejected'});
  assert.equal(calls,1);
});

test('concurrent slot sync batches two keys into one write and two reads', async () => {
  const records={};
  let reads=0,writes=0;
  const cloud={scope:'toy',load:async()=>{reads++;return {...records};},save:async values=>{writes++;Object.assign(records,values);}};
  const store=new GameStorage({namespace:'g',schema:{version:1,validate:Number.isInteger},session:{mode:'cloud',cloud,playerKey:'a'}});
  await store.put('one',1);
  await store.put('two',2);
  await Promise.all([store.sync(),store.sync()]);
  assert.deepEqual([reads,writes],[2,1]);
});

test('no Web Locks fails before mutating persistent storage, explicit memory works', async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{}});
  const old=globalThis.Storage;
  globalThis.Storage=class {getItem(){return null;}setItem(){throw new Error('unexpected write');}};
  try {
    const options={namespace:'g',schema:{version:1,validate:Number.isInteger},session:{mode:'guest'}};
    const durable=new GameStorage({...options,cache:new Storage()});
    await assert.rejects(durable.put('a',1),{type:'cache_lock_unavailable'});
    const memory=new GameStorage(options);
    await memory.put('a',1);
    assert.equal(memory.diagnostics().persistence,'memory');
  } finally { Object.defineProperty(globalThis,'navigator',previousNavigator); if(old) globalThis.Storage=old; else delete globalThis.Storage; }
});
