import {type ToySDK,type KV,type Board,type RankQuery,validateItems,validateKey,validateRank,validateScore} from '../sdk-contract/index.js';
export class ToyAdapter {
 constructor(private readonly sdk:ToySDK) {if(!sdk)throw new Error('sdk_unavailable');}
 static fromWindow():ToyAdapter {
 const sdk=(globalThis as typeof globalThis & {toy?:ToySDK}).toy;
 if(!sdk)throw new Error('sdk_unavailable');
 return new ToyAdapter(sdk);
 }
 async supports(name:keyof ToySDK):Promise<boolean>{
 return typeof this.sdk[name]==='function'&&await this.sdk.isSupport(name);
 }
 async load(keys?:string[]){keys?.forEach(validateKey);return this.sdk.getCloudStorage(keys);}
 async save(items:KV){validateItems(items);return this.sdk.setCloudStorage(items);}
 async remove(keys:string[]){keys.forEach(validateKey);return this.sdk.removeCloudStorage(keys);}
 async profile(){return this.sdk.getUserProfile();}
 async submit(score:number,board:Board=1){validateRank({board});validateScore(score);return this.sdk.submitScore({board,score});}
 async ranks(req:RankQuery & {limit?:number}={}){validateRank(req);if(req.limit!==undefined&&(!Number.isInteger(req.limit)||req.limit<1||req.limit>100))throw new Error('invalid_param: limit');return this.sdk.getRankList(req);}
 async myRank(req:RankQuery={}){validateRank(req);return this.sdk.getMyRank(req);}
}
