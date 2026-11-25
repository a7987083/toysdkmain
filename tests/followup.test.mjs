import test from 'node:test';
import assert from 'node:assert/strict';
import {GameStorage,GameLeaderboard,GameViewport,ToyRuntime,ToyAdapter} from '../dist/index.js';
const schema = version => ({version,validate:Number.isInteger});
const cache = () => {const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('a legacy reader cannot delete a future save',async()=>{
  const options={namespace:'v',session:{mode:'guest'},cache:cache()};
  await new GameStorage({...options,schema:schema(2)}).put('k',1);
  await assert.rejects(new GameStorage({...options,schema:schema(1)}).remove('k'),{type:'unsupported_version'});
});
test('write IDs use secure random bytes when UUID is unavailable',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const records={};
  const cloud={scope:'toy',load:async()=>({...records}),save:async values=>Object.assign(records,values)};
  const store=new GameStorage({namespace:'v',schema:schema(1),session:{mode:'cloud',playerKey:'a',cloud}});
  try {
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}});
    await store.put('k',1);
    await assert.rejects(store.sync(),/secure_random_unavailable/);
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:array=>array.fill(17)}});
    assert.deepEqual((await store.sync()).written,['k']);
  } finally {Object.defineProperty(globalThis,'crypto',descriptor);}
});
test('runtime rebuilds a directly disposed adapter',async()=>{
  const runtime=new ToyRuntime({sdk:{isSupport:async()=>true}});
  const old=await runtime.initialize();
  await old.dispose();
  assert.notEqual(await runtime.initialize(),old);
  await runtime.dispose();
});
test('rank reads cache successful results and support force refresh',async()=>{
  let calls=0;
  const board=new GameLeaderboard(new ToyAdapter({getRankList:async()=>{calls++;return [];}}),1,
    {gameKey:'g',playerKey:'a',storage:cache(),readTtlMs:1000});
  await board.list();await board.list();
  assert.equal(calls,1);
  await board.list({}, {refresh:true});
  assert.equal(calls,2);
});
test('viewport refresh after visibility restore unsubscribes cleanly',async()=>{
  let calls=0;
  const visibility=new EventTarget();
  const viewport=new GameViewport(new ToyAdapter({getContainerState:async()=>{calls++;throw Error('offline');}}),null,visibility);
  const off=viewport.watch(()=>{});
  await viewport.refresh();
  const before=calls;
  visibility.dispatchEvent(new Event('visibilitychange'));
  await new Promise(setImmediate);
  assert.equal(calls,before+1);
  off();
  await viewport.refresh();
  assert.equal(calls,before+1);
});

test('facade preserves gestures and subscriptions; public contract has one mapping per method',async()=>{
  const {createToyFacade,MockSDK,MockStore}=await import('../dist/index.js');
  const fixture=new MockSDK(new MockStore(),'test','a',new Set(),{environment:'app'});
  let invoked=false;
  const runtime=new ToyRuntime({sdk:new Proxy(fixture,{get(target,key){
    if(key==='openChargePanel')return ()=>{invoked=true;return Promise.resolve();};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }})});
  const toy=createToyFacade(runtime);
  assert.throws(()=>toy.charge.open({minPrice:1200}),/call_ready_first/);
  await toy.ready();
  const result=toy.charge.open({minPrice:1200});
  assert.equal(invoked,true);
  await result;
  assert.equal(typeof toy.container.onClose(()=>{}),'function');
  const facade=await (await import('node:fs/promises')).readFile(new URL('../packages/game-context/facade.ts',import.meta.url),'utf8');
  const {promiseMethods,subscriptionMethods}=await import('../dist/index.js');
  const bindings=[...facade.matchAll(/(?:call|event)\('([A-Za-z]+)'\)/g)].map(m=>m[1]);
  assert.deepEqual([...bindings,'isSupport'].sort(),[...promiseMethods,...subscriptionMethods].filter(k=>k!=='getAuthorVideoRange').sort());
  await runtime.dispose();
});

test('borrowed contexts isolate services, preserve verified same-user instances and clean up independently',async()=>{
  const {createToyGame,MockSDK,MockStore}=await import('../dist/index.js');
  const sdk=new MockSDK(new MockStore(),'test','a',new Set(),{simulatedIdentity:true});
  const runtime=new ToyRuntime({sdk});
  const opts={namespace:'test',runtime,storage:{schema:schema(1)}};
  const [first,second]=await Promise.all([createToyGame(opts),createToyGame(opts)]);
  assert.throws(()=>first.storage);
  await first.session.refresh();
  const storage=first.storage;
  await first.session.refresh();
  assert.equal(first.storage,storage);
  sdk.switchPlayer('b');await first.session.refresh();
  assert.notEqual(first.storage,storage);
  assert.throws(()=>storage.get('k'));
  await Promise.all([first.dispose(),first.dispose()]);
  assert.equal(runtime.state,'ready');
  second.session.enterGuest();await second.storage.put('k',3);
  await second.dispose();await runtime.dispose();
});
