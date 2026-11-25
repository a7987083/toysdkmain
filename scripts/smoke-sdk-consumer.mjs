import { execFileSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const archive = resolve(process.argv[2] ?? '');
await access(archive);
const consumer = await mkdtemp(join(tmpdir(), 'toy-game-kit-consumer-'));
const tsc = resolve('node_modules/typescript/bin/tsc');
try {
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'toy-game-consumer', private: true, type: 'module' }));
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: consumer, stdio: 'inherit' });
  const installed = join(consumer, 'node_modules/toy-game-kit');
  const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  for (const entry of Object.values(metadata.exports)) {
    await access(join(installed, entry.types));
    await access(join(installed, entry.default));
  }
  await writeFile(join(consumer, 'game.mts'), `
import { GameStorage, MockSDK, MockStore, type SaveSchema } from 'toy-game-kit';
import { ToyRuntime } from 'toy-game-kit/sdk-runtime';
import { ToySession } from 'toy-game-kit/sdk-session';

const schema: SaveSchema<number> = { version: 1, validate: (value): value is number => typeof value === 'number' };
let absent = false;
try { await new ToyRuntime({ timeoutMs: 0 }).initialize(); }
catch (error) { absent = (error as { type?: string }).type === 'sdk_unavailable'; }
if (!absent) throw new Error('unexpected host fallback');
const sdk = new MockSDK(new MockStore(), 'smoke-game', 'player', undefined, { simulatedIdentity: true });
const runtime = new ToyRuntime({ sdk });
const adapter = await runtime.initialize();
const session = new ToySession(adapter);
await session.refresh();
const saves = new GameStorage({ namespace: 'smoke-game', schema, session: session.storage() });
await saves.put('level', 3);
const { written } = await saves.sync();
if (written.length !== 1 || saves.get('level') !== 3) throw new Error('consumer save failed');
await runtime.dispose();
if (globalThis.document) document.documentElement.dataset.consumer = 'ready';
`);
  execFileSync(process.execPath, [tsc, '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--outDir', 'build', 'game.mts'], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, ['build/game.mjs'], { cwd: consumer, stdio: 'inherit' });
  const dist = resolve('dist/sdk-consumer');
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(join(installed, 'dist'), join(dist, 'sdk'), { recursive: true });
  await cp(join(consumer, 'build/game.mjs'), join(dist, 'game.js'));
  await writeFile(join(dist, 'index.html'), `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"toy-game-kit":"./sdk/index.js","toy-game-kit/sdk-runtime":"./sdk/sdk-runtime/index.js","toy-game-kit/sdk-session":"./sdk/sdk-session/index.js"}}</script>
<script type="module" src="./game.js"></script>\n`);
  console.log('Installed TGZ, compiled and ran the independent TypeScript game');
} finally {
  await rm(consumer, { recursive: true, force: true });
}
