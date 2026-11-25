import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

const profile = await mkdtemp(join(tmpdir(), 'tgk-browser-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff': 'font/woff' };
const prefix = '/toy/sdk-lab/';
const server = createServer(async (req, res) => {
  const path = req.url === prefix ? prefix + 'index.html' : req.url;
  if (!path.startsWith(prefix) || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..')) {
    res.writeHead(404).end();
    return;
  }
  try {
    const relative = path.slice(prefix.length);
    const target = relative === 'vite/' ? 'vite-consumer/index.html'
      : relative.startsWith('vite/') ? 'vite-consumer/' + relative.slice(5)
      : relative === 'consumer/' ? 'sdk-consumer/index.html'
      : relative.startsWith('consumer/') ? 'sdk-consumer/' + relative.slice('consumer/'.length)
      : 'sdk-test-lab/' + relative;
    const body = await readFile(new URL('../dist/' + target, import.meta.url));
    res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}${prefix}`;
const browser = spawn(process.env.CHROME_BIN ?? 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--no-proxy-server', '--host-resolver-rules=MAP s1.hdslb.com ~NOTFOUND', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserError = '';
let output = '';
let debugPort;
browser.on('error', error => { browserError = error.message; });
browser.stderr.on('data', chunk => {
  output = (output + chunk).slice(-6000);
  debugPort ??= output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
});
let socket;
try {
  let page;
  for (let retry = 0; retry < 300 && !page; retry++) {
    await delay(100);
    if (browserError || browser.exitCode !== null) throw new Error(browserError || output);
    try {
      const port = debugPort ?? (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      page = (await response.json()).find(target => target.type === 'page');
    } catch {}
  }
  assert.ok(page, 'Chromium exposed no page target: ' + output);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  async function send(method, params = {}) {
    const next = ++id;
    const response = new Promise(resolve => pending.set(next, resolve));
    socket.send(JSON.stringify({ id: next, method, params }));
    const result = await response;
    assert.equal(result.error, undefined);
    return result.result;
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined);
    return result.result.value;
  }
  async function until(expression) {
    for (let retry = 0; retry < 70; retry++) {
      if (await evaluate(expression)) return;
      if (exceptions.length) throw new Error(exceptions.join('\n'));
      await delay(100);
    }
    throw new Error('Timed out: '+expression);
  }
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await until('document.querySelectorAll("#methods button").length === 37');
  assert.equal(await evaluate('document.querySelector("#run").disabled'), true);
  await evaluate('document.querySelector("#mode").click()');
  await until('document.querySelector("#session").textContent.includes("Mock") && !document.querySelector("#run").disabled');
  const select = name => evaluate(`[...document.querySelectorAll("#methods button")].find(b=>b.firstChild.textContent===${JSON.stringify(name)}).click()`);
  await select('setCloudStorage');
  await evaluate('document.querySelector("#run").click()');
  await until('document.querySelector("#result").textContent.includes("setCloudStorage") && !document.querySelector("#run").disabled');
  await select('getCloudStorage');
  await evaluate('document.querySelector("#run").click()');
  await until('document.querySelector("#result").textContent.includes("toy_game_kit_lab")');
  await select('onContainerChange');
  await evaluate('document.querySelector("#run").click()');
  await until('document.querySelector("#result").textContent.includes("viewport")');
  await evaluate('document.querySelector("#unsubscribe").click()');
  await until('document.querySelector("#result").textContent.includes("unsubscribed")');
  await evaluate('document.querySelector("#profile").click()');
  await until('document.querySelector("#runtime-state").textContent.includes("user")');
  await evaluate('document.querySelector("#scenario").click()');
  await until(`JSON.parse(document.querySelector('#result').textContent).result?.recovered === true`);
  assert.equal(await evaluate('navigator.locks?.request instanceof Function'), true);
  const race = await evaluate(`(async () => {
    const { GameStorage } = await import('./kit/game-storage/index.js');
    const config = { namespace: 'browser-smoke', schema: { version: 1, validate: value => typeof value === 'number' },
      session: { mode: 'guest' }, cache: localStorage };
    const a = new GameStorage(config);
    const b = new GameStorage(config);
    const results = await Promise.allSettled([a.put('one', 1), b.put('two', 2)]);
    await Promise.all([a.close(), b.close()]);
    return results.map(result => result.status === 'fulfilled' ? 'ok' : result.reason.type).sort();
  })()`);
  assert.deepEqual(race, ['cache_changed', 'ok']);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.deepEqual(exceptions, []);
  if (process.argv.includes('--consumer')) {
    const navigation = await send('Page.navigate', { url: url + 'consumer/' });
    assert.equal(navigation.errorText, undefined);
    assert.notEqual(navigation.isDownload, true);
    await until('document.documentElement.dataset.consumer === "ready"');
    await send('Page.navigate', { url: url + 'vite/#game' });
    await until("document.querySelector('#status')?.textContent === 'SDK 已载入'");
    const previous = await evaluate('document.documentElement.dataset.navigation');
    await send('Page.reload', { ignoreCache: true });
    await until(`document.documentElement.dataset.consumer === "ready" && document.documentElement.dataset.navigation !== ${JSON.stringify(previous)}`);
    assert.deepEqual(exceptions, []);
  }
  console.log('Chromium smoke passed: 37 methods, explicit Mock, storage, event subscription, 390px mobile layout');
} finally {
  socket?.close();
  server.close();
  if (browser.pid && browser.exitCode === null && browser.signalCode === null) {
    browser.kill();
    await once(browser, 'exit');
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
