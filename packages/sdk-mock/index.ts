import {type KV,type ToySDK,type Board,type RankQuery,type RankItem,validateItems,validateKey,validateRank,validateScore} from '../sdk-contract/index.js';
export class MockStore {
 readonly saves=new Map<string,Map<string,string>>();
 readonly ranks=new Map<string,Map<string,number>>();
}
export class MockSDK implements ToySDK {
 constructor(private readonly store:MockStore,private readonly toy:string,private readonly player:string|null,private readonly allowedShared:ReadonlySet<string>=new Set()){}
 private user(){if(!this.player)throw new Error('not_logged_in');return this.player;}
 private bucket(scope:string){const key=JSON.stringify([scope,this.user()]);let map=this.store.saves.get(key);if(!map){map=new Map();this.store.saves.set(key,map);}return map;}
 private shared(id:string){if(!this.allowedShared.has(id))throw new Error('no_permission');return 'shared:'+id;}
 private read(scope:string,keys?:string[]):KV{keys?.forEach(validateKey);const b=this.bucket(scope);return Object.fromEntries([...b].filter(([k])=>!keys?.length||keys.includes(k)));}
 private write(scope:string,items:KV){validateItems(items);const b=this.bucket(scope);if(new Set([...b.keys(),...Object.keys(items)]).size>128)throw new Error('invalid_param: key count');for(const [k,v] of Object.entries(items))b.set(k,v);}
 private remove(scope:string,keys:string[]){keys.forEach(validateKey);const b=this.bucket(scope);keys.forEach(k=>b.delete(k));}
 async isSupport(name:string){return ['isSupport','getUserProfile','getCloudStorage','setCloudStorage','removeCloudStorage','getSharedStorage','setSharedStorage','removeSharedStorage','submitScore','getRankList','getMyRank'].includes(name);}
 async getUserProfile(){return {avatar:'',nickname:this.user()};}
 async getCloudStorage(keys?:string[]){return this.read('toy:'+this.toy,keys);}
 async setCloudStorage(items:KV){this.write('toy:'+this.toy,items);}
 async removeCloudStorage(keys:string[]){this.remove('toy:'+this.toy,keys);}
 async getSharedStorage(id:string,keys?:string[]){return this.read(this.shared(id),keys);}
 async setSharedStorage(id:string,items:KV){this.write(this.shared(id),items);}
 async removeSharedStorage(id:string,keys:string[]){this.remove(this.shared(id),keys);}
 private board(board:Board=1){const key=JSON.stringify([this.toy,board]);let b=this.store.ranks.get(key);if(!b){b=new Map();this.store.ranks.set(key,b);}return b;}
 async submitScore(req:{board?:Board;score:number}){validateRank(req);validateScore(req.score);const b=this.board(req.board),p=this.user(),old=b.get(p);if(old===undefined||req.score>old){b.delete(p);b.set(p,req.score);}return {score:b.get(p)!};}
 private sorted(req:RankQuery){validateRank(req);if(req.period&&req.period!=='all')throw new Error('unsupported: mock period');return [...this.board(req.board)].sort((a,b)=>b[1]-a[1]);}
 async getRankList(req:RankQuery & {limit?:number}={}):Promise<RankItem[]>{return this.sorted(req).slice(0,req.limit??100).map(([nickname,score],i)=>({nickname,score,rank:i+1,avatar:''}));}
 async getMyRank(req:RankQuery={}){const p=this.user(),rows=this.sorted(req),i=rows.findIndex(([name])=>name===p);return {ranked:i>=0,rank:i+1,score:rows[i]?.[1]??0};}
}
