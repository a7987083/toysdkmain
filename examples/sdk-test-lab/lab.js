import { ToyAdapter } from './kit/sdk-adapter/index.js';
import { promiseMethods, subscriptionMethods } from './kit/sdk-contract/index.js';
import { MockSDK, MockStore } from './kit/sdk-mock/index.js';

const byId = id => document.getElementById(id);
const metadata = await fetch(new URL('./baseline.json', import.meta.url))
  .then(response => response.ok ? response.json() : null).catch(() => null);
const host = window.top === window ? '顶层页面' : '嵌入页面';
byId('baseline').textContent = metadata ? `核对基线 ${metadata.sdkVersion} · ${host}` : host;
const session = byId('session');
const run = byId('run');
const args = byId('args');
const results = byId('result');
const media = byId('media');
let probing = false;
const list = byId('methods');
const unsubscribe = byId('unsubscribe');
const mode = byId('mode');
const probe = byId('probe');
const events = new Set(subscriptionMethods);
const publicMethods = [...promiseMethods, ...events].sort();
const support = new Map();
const listening = new Map();
const history = [];
const input = {
  isSupport: ['getCloudStorage'], navigate: [{ type: 'video', id: 'BV17x411w7KC' }],
  saveImageToAlbum: [{ url: '' }], share: [{ path: 'index.html' }],
  getQrCode: [{ size: 320 }], sharePicture: [{ url: '' }],
  getAuthorVideos: [{ videos: [{ aid: 170001 }] }], getVideoUserActions: [{ aids: [170001] }],
  getAnnualReport: [{ edition: '2026' }], getChargeUnlock: [{ minPrice: 1200 }],
  openChargePanel: [{ minPrice: 1200 }],
  setCloudStorage: [{ toy_game_kit_lab: 'test' }],
  removeCloudStorage: [['toy_game_kit_lab']],
  getSharedStorage: ['st_', ['toy_game_kit_lab']],
  setSharedStorage: ['st_', { toy_game_kit_lab: 'test' }],
  removeSharedStorage: ['st_', ['toy_game_kit_lab']],
  submitScore: [{ board: 5, score: 0 }], getRankList: [{ board: 5, limit: 10 }],
  getMyRank: [{ board: 5 }], requestCamera: [{ facingMode: 'environment' }],
  setContainerMode: [{ orientation: 'landscape', immersive: true }],
  setPlayerState: [{ playing: false }], checkInputSafety: [{ text: 'Toy SDK test', scene: 'sdk-lab' }],
};

let adapter;
let mockMode = false;
let selection = 'isSupport';
let sourceEpoch = 0;
let stream;
let running = false;

function updateButtons() {
  run.disabled = !adapter || running;
  run.textContent = events.has(selection) ? '开始监听' : '运行方法';
  unsubscribe.disabled = !listening.has(selection);
  args.disabled = events.has(selection) || selection === 'stopMedia';
  probe.disabled = !adapter || probing;
}

function select(method) {
  selection = method;
  byId('method').textContent = method;
  byId('note').textContent = events.has(method) ? '同步返回取消函数。收到事件后在下方更新。'
    : method === 'stopMedia' ? '释放本实验室最近一次获取的媒体流。'
      : method === 'submitScore' ? '会向当前 Toy 的第 5 榜提交测试分数，可修改参数。'
        : method === 'openChargePanel' ? '会拉起官方充电面板。'
          : method.includes('SharedStorage') ? '请填写创作中心分配的共享存档 ID。' : '';
  args.value = JSON.stringify(input[method] ?? [], null, 2);
  updateButtons();
  renderMethods();
}

function renderMethods() {
  const query = byId('filter').value.toLowerCase();
  list.replaceChildren(...publicMethods.filter(name => name.toLowerCase().includes(query)).map(name => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(name === selection));
    button.textContent = name;
    button.addEventListener('click', () => select(name));
    const state = document.createElement('small');
    const isSupported = support.get(name);
    state.textContent = isSupported === true ? '支持' : isSupported === false ? '未探测到' : '';
    state.dataset.supported = String(isSupported);
    button.append(state);
    return button;
  }));
}

function sanitize(key, value) {
  if (/token|cookie|password|secret|challenge|openid|^uid$|^mid$/i.test(key)) return '[已隐藏]';
  if (typeof value === 'string' && value.length > 700) return value.slice(0, 700) + '…';
  return value;
}

function record(method, status, start, value, error) {
  const row = { at: new Date().toISOString(), mode: mockMode ? 'mock' : 'official',
    method, status, elapsedMs: Math.round(performance.now() - start) };
  if (error) {
    row.type = error.type || 'lab_error';
    if (typeof error.code === 'number') row.code = error.code;
  }
  history.push(row);
  if (history.length > 200) history.shift();
  results.textContent = JSON.stringify({ ...row, result: value }, sanitize, 2);
}

async function activate(useMock) {
  const epoch = ++sourceEpoch;
  mode.disabled = Boolean(adapter);
  const previous = adapter;
  adapter = undefined;
  listening.clear();
  support.clear();
  stream = undefined;
  media.replaceChildren();
  results.textContent = '选择方法后手动运行。';
  session.textContent = useMock ? '正在启用 Mock' : '等待官方 SDK';
  updateButtons();
  renderMethods();
  try {
    await previous?.dispose();
    const next = useMock ? new ToyAdapter(new MockSDK(new MockStore(), 'sdk-lab', 'mock-player', new Set(), {
      environment: 'app',
      charge: { status: 'ok', data: { unlocked: false } },
    })) : await ToyAdapter.waitForWindow(5000);
    if (epoch !== sourceEpoch) {
      await next.dispose();
      return;
    }
    adapter = next;
    mockMode = useMock;
    session.textContent = useMock ? '显式 Mock · App 场景' : '官方 SDK 已加载';
  } catch {
    if (epoch !== sourceEpoch) return;
    mockMode = useMock;
    session.textContent = useMock ? 'Mock 初始化失败' : '官方 SDK 未就绪';
  }
  mode.disabled = false;
  mode.textContent = mockMode ? '切换到官方 SDK' : '启用本地 Mock';
  updateButtons();
}

run.addEventListener('click', async () => {
  const active = adapter;
  if (!active || running) return;
  const method = selection;
  const start = performance.now();
  const epoch = sourceEpoch;
  running = true;
  updateButtons();
  try {
    if (events.has(method)) {
      listening.get(method)?.();
      listening.set(method, active.subscribe(method, value => record(method, 'event', start, value)));
      if (method === 'onChargeUnlockChange' || method === 'onPageClose') record(method, 'subscribed', start);
      return;
    }
    const raw = JSON.parse(args.value);
    if (!Array.isArray(raw)) throw { type: 'expected_array' };
    if (method === 'stopMedia' && !stream) throw { type: 'no_stream' };
    const response = await active.call(method, ...(method === 'stopMedia' ? [stream] : raw));
    if (epoch !== sourceEpoch) return;
    if (['requestCamera', 'requestMicrophone'].includes(method)) {
      const previous = stream;
      stream = response;
      if (previous) await active.call('stopMedia', previous);
      if (epoch !== sourceEpoch) return;
      if (method === 'requestCamera') {
        const video = document.createElement('video');
        video.controls = true;
        video.muted = true;
        video.playsInline = true;
        video.srcObject = response;
        media.replaceChildren(video);
        void video.play().catch(() => {});
      } else {
        media.replaceChildren();
      }
      record(method, 'ok', start, { tracks: response.getTracks().map(track => track.kind) });
      return;
    }
    if (method === 'stopMedia') {
      stream = undefined;
      media.replaceChildren();
    }
    record(method, 'ok', start, response);
  } catch (error) {
    if (epoch === sourceEpoch) record(method, 'error', start, undefined,
      error instanceof SyntaxError ? { type: 'invalid_json' } : error);
  } finally {
    running = false;
    updateButtons();
  }
});

probe.addEventListener('click', async () => {
  const active = adapter;
  if (!active || probe.disabled) return;
  probing = true;
  updateButtons();
  for (const name of publicMethods) {
    if (active !== adapter) break;
    try {
      support.set(name, await active.supports(name));
    } catch {
      support.set(name, undefined);
    }
    if (active === adapter) renderMethods();
  }
  probing = false;
  updateButtons();
});

mode.addEventListener('click', () => void activate(!mockMode));
byId('filter').addEventListener('input', renderMethods);
unsubscribe.addEventListener('click', () => {
  const start = performance.now();
  try {
    listening.get(selection)?.();
    record(selection, 'unsubscribed', start);
  } catch (error) {
    record(selection, 'error', start, undefined, error);
  } finally {
    listening.delete(selection);
    updateButtons();
  }
});

byId('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'toy-sdk-lab-results.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.addEventListener('visibilitychange', () => record('visibilitychange', document.visibilityState, performance.now()));
select(selection);
void activate(false);
