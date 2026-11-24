export type KV = Record<string,string>;
export type Board = 1|2|3|4|5;
export type Period = 'all'|'month'|'week'|'day';
export interface RankQuery {board?:Board;period?:Period}
export interface RankItem {rank:number;score:number;nickname:string;avatar:string}
export interface ToySDK {
 isSupport(name:string):Promise<boolean>;
 getUserProfile():Promise<{avatar:string;nickname:string;toyOpenId?:string}>;
 getCloudStorage(keys?:string[]):Promise<KV>;
 setCloudStorage(items:KV):Promise<void>;
 removeCloudStorage(keys:string[]):Promise<void>;
 getSharedStorage(id:string,keys?:string[]):Promise<KV>;
 setSharedStorage(id:string,items:KV):Promise<void>;
 removeSharedStorage(id:string,keys:string[]):Promise<void>;
 submitScore(req:{board?:Board;score:number}):Promise<{score:number}>;
 getRankList(req?:RankQuery & {limit?:number}):Promise<RankItem[]>;
 getMyRank(req?:RankQuery):Promise<{ranked:boolean;rank:number;score:number}>;
}
export const limits={maxKeys:128,maxKeyBytes:128,maxValueBytes:1024,minScore:-16777216,maxScore:16777215} as const;
export function validateKey(key:string):void {
 if(typeof key!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(key)||key.startsWith('__'))throw new Error('invalid_param: key');
}
export function validateItems(items:KV):void {
 if(!items||typeof items!=='object'||Array.isArray(items))throw new Error('invalid_param: items');
 const entries=Object.entries(items);
 if(entries.length>limits.maxKeys)throw new Error('invalid_param: key count');
 for(const [k,v] of entries){validateKey(k);if(typeof v!=='string'||new TextEncoder().encode(v).length>limits.maxValueBytes)throw new Error('invalid_param: value');}
}
export function validateRank(req:RankQuery={}):void{
 if(req.board!==undefined&&![1,2,3,4,5].includes(req.board))throw new Error('invalid_param: board');
 if(req.period!==undefined&&!['all','month','week','day'].includes(req.period))throw new Error('invalid_param: period');
}
export function validateScore(score:number):void{
 if(!Number.isInteger(score)||score<limits.minScore||score>limits.maxScore)throw new Error('invalid_param: score');
}
