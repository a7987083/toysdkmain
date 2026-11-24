import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { promiseMethods, subscriptionMethods } from '../dist/sdk-contract/index.js';

const exec = promisify(execFile);
const manifest = new URL('../upstream/stable/manifest.json', import.meta.url);

test('the framework method list matches the public declaration in the audited manifest', async () => {
  const baseline = JSON.parse(await readFile(manifest, 'utf8'));
  const methods = [...promiseMethods, ...subscriptionMethods].sort();
  assert.deepEqual(methods, Object.keys(baseline.document.methodHashes).sort());
  assert.deepEqual(baseline.sdk.methods.filter(method => !methods.includes(method)), ['reportAction']);
});

test('offline SDK monitor parses without executing and keeps the Stable file intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'toy-sdk-monitor-'));
  try {
    const sdk = join(directory, 'candidate.js');
    const stableBefore = await readFile(manifest, 'utf8');
    await writeFile(sdk, `
      throw Error("the downloader must not execute this file");
      let Exported = class { getUserProfile() {} newAbility() {} };
      var instance = new Exported();
      window.toy = instance;
      const diagnostics = { sdk_version: \`0.6.0\` };
    `);
    await exec(process.execPath, ['scripts/sdk-monitor.mjs', '--sdk', sdk, '--output', join(directory, 'out')]);
    const { sdk: report } = JSON.parse(await readFile(join(directory, 'out', 'diff.json'), 'utf8'));
    assert.equal(report.hashChanged, true);
    assert.equal(report.versionChanged, true);
    assert.deepEqual(report.added, ['newAbility']);
    assert.equal(report.removed.includes('reportAction'), true);
    assert.equal(report.removed.includes('getUserProfile'), false);
    assert.equal(await readFile(manifest, 'utf8'), stableBefore);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
