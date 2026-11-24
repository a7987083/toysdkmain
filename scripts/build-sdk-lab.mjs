import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/sdk-test-lab/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('examples/sdk-test-lab/', root), output, { recursive: true });
for (const name of ['sdk-adapter', 'sdk-contract', 'sdk-mock']) {
  await cp(new URL(`dist/${name}/`, root), new URL(`kit/${name}/`, output), {
    recursive: true,
    filter: path => !path.endsWith('.d.ts'),
  });
}
const baseline = JSON.parse(await readFile(new URL('upstream/stable/manifest.json', root), 'utf8'));
await writeFile(new URL('baseline.json', output), JSON.stringify({ sdkVersion: baseline.sdk.version }) + '\n');
