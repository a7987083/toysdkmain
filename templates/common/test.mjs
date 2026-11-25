import test from 'node:test';
import assert from 'node:assert/strict';
import {createToyGame,MockSDK,MockStore} from 'toy-game-kit';
test('save a completed round and recover it on a fresh context',async()=>{
  const sdk=new MockSDK(new MockStore(),'game','player',new Set(),{simulatedIdentity:true});
  const options={namespace:'sample',runtimeOptions:{sdk},storage:{schema:{version:1,validate:Number.isInteger}}};
  const a=await createToyGame(options);await a.session.refresh();
  await a.storage.put('score',2);await a.storage.sync();await a.leaderboard().submitSettlement('round',2);await a.dispose();
  const b=await createToyGame(options);await b.session.refresh();await b.storage.sync(['score']);
  assert.equal(b.storage.get('score'),2);await b.dispose();
});
