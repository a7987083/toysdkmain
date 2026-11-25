import {access,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const [kind,destination,archive,...extra]=process.argv.slice(2);
if (!['vanilla-ts','phaser'].includes(kind)||!destination||!archive||extra.length) throw Error('Usage: node scripts/create-game.mjs vanilla-ts|phaser NEW_DIRECTORY SDK_TGZ');
const root=fileURLToPath(new URL('../templates/',import.meta.url));
const lock=JSON.parse(await readFile(join(root,kind,'package-lock.json'),'utf8'));
const pin=lock.packages['node_modules/toy-game-kit'];
const bytes=await readFile(resolve(archive));
if(basename(archive)!==basename(pin.resolved)||'sha512-'+createHash('sha512').update(bytes).digest('base64')!==pin.integrity)throw Error('SDK archive does not match template lock');
const dest=resolve(destination);
await mkdir(dest); // Refuse existing directories, including an existing checkout.
await cp(join(root,'common'),dest,{recursive:true});
await cp(join(root,kind),dest,{recursive:true});
await mkdir(join(dest,'vendor'));
await writeFile(join(dest,'vendor',basename(archive)),bytes);
console.log(dest);
