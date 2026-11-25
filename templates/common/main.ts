import { createToyGame } from 'toy-game-kit/game-context';
import type { RuntimeOptions } from 'toy-game-kit/sdk-runtime';
import { play } from './scene';
const status = document.querySelector('#status')!;
const button = (id: string) => document.querySelector<HTMLButtonElement>('#'+id)!;
async function boot() {
  let runtimeOptions: RuntimeOptions | undefined;
  if (import.meta.env.MODE === 'mock') {
    const {MockSDK,MockStore} = await import('toy-game-kit/sdk-mock');
    runtimeOptions = {sdk:new MockSDK(new MockStore(),'template','player',new Set(),{environment:'app',simulatedIdentity:true})};
  }
  const game = await createToyGame({namespace:'sample',runtimeOptions,storage:{
    schema:{version:1,validate:(value:unknown):value is number=>typeof value==='number' && Number.isSafeInteger(value) && value>=0},
    cache:localStorage
  }});
  let score=0, round='', sequence=0;
  let stop: (()=>void)|undefined;
  let busy=false;
  let roundStorage: typeof game.storage | undefined;
  let checkRound: (()=>void) | undefined;
  game.session.watchVisibility();
  const show = (message:string)=>{status.textContent=message;};
  for(const id of ['save','finish']) button(id).disabled=true;
  button('start').onclick=async()=>{
    if(busy)return;
    busy=true;
    try {
      const user=await game.session.refresh();
      const cloud=user.status==='user' && user.persistentIdentity;
      if(!cloud) game.session.enterGuest();
      roundStorage=game.storage;
      checkRound=cloud ? game.session.scope() : undefined;
      if(cloud) await roundStorage.sync(['score']);
      score=game.storage.get('score')??0;
      const bytes=crypto.getRandomValues(new Uint32Array(4));
      round=Array.from(bytes,word=>word.toString(16).padStart(8,'0')).join('');
      stop?.();
      const current=++sequence;
      stop=await play(()=>{if(current===sequence){score++;show('得分 '+score);}});
      show((cloud?'玩家':'本地游客')+' · 得分 '+score);
      button('save').disabled=false;
      button('finish').disabled=!cloud;
    } catch(error){show(String(error));} finally {busy=false;}
  };
  button('save').onclick=async()=>{
    if(busy)return;
    busy=true;
    try {
      if(!roundStorage) return;
      checkRound?.();
      await roundStorage.put('score',score);
      if(game.session.current.status==='user') {
        const report=await roundStorage.sync(['score']);
        if(report.conflicts.length)throw Error('存档冲突，请保留本地进度并检查云端');
      }
      show('已保存');
    } catch(error){show(String(error));} finally{busy=false;}
  };
  button('finish').onclick=async()=>{
    if(busy)return;
    busy=true; button('finish').disabled=true;
    sequence++;stop?.();stop=undefined;
    try {checkRound?.();await game.leaderboard().submitSettlement(round,score);show('已结算');}
    catch(error){show(String(error));} finally{busy=false;}
  };
  addEventListener('pagehide',()=>{stop?.();void game.dispose();},{once:true});
  show(import.meta.env.MODE==='mock'?'本地 Mock · 就绪':'就绪');
}
void boot().catch(error=>{status.textContent=String(error);});
