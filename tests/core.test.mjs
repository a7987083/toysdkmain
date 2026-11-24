import test from 'node:test';
import assert from 'node:assert/strict';
import {MockSDK,MockStore} from '../dist/sdk-mock/index.js';
import {ToyAdapter} from '../dist/sdk-adapter/index.js';
test('cloud isolation and UTF8 validation',async()=>{const s=new MockStore(),a=new ToyAdapter(new MockSDK(s,'a','p')),b=new ToyAdapter(new MockSDK(s,'b','p')),c=new ToyAdapter(new MockSDK(s,'a','q'));await a.save({gold:'10'});assert.deepEqual(await a.load(),{gold:'10'});assert.deepEqual(await b.load(),{});assert.deepEqual(await c.load(),{});await assert.rejects(a.save({x:'汉'.repeat(342)}));await assert.rejects(a.save({__reserved:'1'}));});
test('rank maximum and zero',async()=>{const s=new MockStore(),a=new ToyAdapter(new MockSDK(s,'a','p'));assert.equal((await a.myRank()).ranked,false);await a.submit(0);await a.submit(-1);assert.deepEqual(await a.myRank(),{ranked:true,rank:1,score:0});await assert.rejects(a.submit(16777216));});
test('guest and shared scope',async()=>{const s=new MockStore(),allowed=new Set(['st_example']),a=new MockSDK(s,'a','p',allowed),b=new MockSDK(s,'b','p',allowed),guest=new MockSDK(s,'a',null);await a.setSharedStorage('st_example',{level:'2'});assert.deepEqual(await b.getSharedStorage('st_example'),{level:'2'});await assert.rejects(guest.getCloudStorage());await assert.rejects(a.getSharedStorage('other'));});
