import { promiseMethods, subscriptionMethods, validateItems, validateKey, validateRank, validateScore, type KV, type PromiseMethod } from '../sdk-contract/index.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function expect(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`invalid_param: ${field}`);
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

const counts = {
  isSupport: [1, 1], navigate: [1, 1], saveImageToAlbum: [1, 1], share: [1, 1],
  getQrCode: [0, 1], sharePicture: [1, 1], closeBrowser: [0, 0], getUserProfile: [0, 0],
  getAuthorProfile: [0, 0], getAuthorVideos: [1, 1], getAuthorVideoRange: [0, 1],
  getAuthorRelation: [0, 0], getVideoUserActions: [1, 1], getAnnualReport: [1, 1],
  getChargeUnlock: [1, 1], openChargePanel: [1, 1], setCloudStorage: [1, 1],
  getCloudStorage: [0, 1], removeCloudStorage: [1, 1], setSharedStorage: [2, 2],
  getSharedStorage: [1, 2], removeSharedStorage: [2, 2], submitScore: [1, 1],
  getRankList: [0, 1], getMyRank: [0, 1], requestCamera: [0, 1], requestMicrophone: [0, 0],
  stopMedia: [1, 1], getContainerState: [0, 0], setContainerMode: [1, 1],
  getPlayerState: [0, 0], setPlayerState: [1, 1], checkInputSafety: [1, 1],
} satisfies Record<PromiseMethod, [number, number]>;

const capabilities = new Set<string>([...promiseMethods, ...subscriptionMethods]);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dimension = (value: unknown) => finite(value) && value >= 0;

function validateKeys(value: unknown, optional: boolean): void {
  if (value === undefined && optional) return;
  expect(Array.isArray(value), 'keys');
  for (const key of value) validateKey(key);
}

function validateVideoRefs(value: unknown): void {
  expect(Array.isArray(value) && value.length >= 1 && value.length <= 50, 'videos');
  for (const item of value) {
    const video = record(item);
    expect(video && (video.aid !== undefined
      ? integer(video.aid, 1) && video.bvid === undefined
      : typeof video.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(video.bvid)), 'video reference');
  }
}

function validatePath(value: unknown): void {
  expect(typeof value === 'string' && !/^(?:[\\/]|[a-z][a-z0-9+.-]*:)/i.test(value.trim()) && !value.includes('\\'), 'path');
  const base = 'https://example.invalid/toy/current/';
  expect(new URL(value, base).href.startsWith(base), 'path');
}

export function validateRequest(method: PromiseMethod, args: readonly unknown[]): void {
  const [min, max] = counts[method];
  expect(args.length >= min && args.length <= max, 'argument count');
  const [first, second] = args;
  const req = record(first);
  switch (method) {
    case 'isSupport':
      expect(typeof first === 'string' && capabilities.has(first), 'ability');
      return;
    case 'getCloudStorage': return validateKeys(first, true);
    case 'removeCloudStorage': return validateKeys(first, false);
    case 'setCloudStorage': return validateItems(first as KV);
    case 'getSharedStorage':
    case 'setSharedStorage':
    case 'removeSharedStorage':
      expect(typeof first === 'string' && /^st_[a-z0-9]{16}$/.test(first), 'storageId');
      if (method === 'setSharedStorage') return validateItems(second as KV);
      return validateKeys(second, method === 'getSharedStorage');
    case 'getRankList':
    case 'getMyRank':
    case 'submitScore':
      expect(req || (first === undefined && method !== 'submitScore'), 'request');
      validateRank(req);
      if (method === 'submitScore') validateScore(req?.score as number);
      if (method === 'getRankList' && req?.limit !== undefined) expect(integer(req.limit, 1), 'limit');
      return;
    case 'navigate':
      expect(req && typeof req.id === 'string' && req.id.length
        && ['video', 'space', 'search', 'opus', 'tribee', 'toy'].includes(req.type as string), 'navigation');
      expect(req.extra === undefined || !!record(req.extra)
        && Object.values(req.extra as Record<string, unknown>).every(value => typeof value === 'string'), 'extra');
      return;
    case 'share': return validatePath(req?.path);
    case 'getQrCode':
      expect(first === undefined || req, 'request');
      if (req?.path !== undefined) validatePath(req.path);
      if (req?.size !== undefined) expect(integer(req.size, 80, 1024), 'size');
      return;
    case 'sharePicture':
    case 'saveImageToAlbum':
      expect(req && (req.url === undefined || typeof req.url === 'string')
        && (req.base64Data === undefined || typeof req.base64Data === 'string')
        && (method !== 'saveImageToAlbum' || req.hintMsg === undefined || typeof req.hintMsg === 'string')
        && ((typeof req.url === 'string' && req.url.length > 0)
        || (typeof req.base64Data === 'string' && req.base64Data.length > 0
          && req.base64Data.length <= (method === 'sharePicture' ? 2 : 5) * 1024 * 1024)), 'image');
      return;
    case 'getAuthorVideos': return validateVideoRefs(req?.videos);
    case 'getVideoUserActions':
      expect(req && (req.aids === undefined) !== (req.videos === undefined), 'aids or videos');
      if (req.aids === undefined) return validateVideoRefs(req.videos);
      expect(Array.isArray(req.aids) && req.aids.length >= 1 && req.aids.length <= 50
        && [...req.aids].every(aid => integer(aid, 1)), 'aids');
      return;
    case 'getAuthorVideoRange':
      expect(first === undefined || req, 'request');
      if (req?.start !== undefined) expect(integer(req.start, 1), 'start');
      if (req?.end !== undefined) expect(integer(req.end, 1), 'end');
      if (typeof req?.start === 'number' && typeof req.end === 'number') {
        expect(req.end > req.start && req.end - req.start <= 366 * 86400, 'video range');
      }
      return;
    case 'getAnnualReport':
      expect(typeof req?.edition === 'string' && /^[0-9]{4}$/.test(req.edition), 'edition');
      return;
    case 'getChargeUnlock':
    case 'openChargePanel':
      expect(integer(req?.minPrice, 1), 'minPrice');
      return;
    case 'requestCamera':
      expect(first === undefined || (req && [undefined, 'user', 'environment'].includes(req.facingMode as string)), 'facingMode');
      return;
    case 'stopMedia':
      expect(first && typeof (first as MediaStream).getTracks === 'function', 'stream');
      return;
    case 'setContainerMode':
      expect(req && (req.orientation !== undefined || req.immersive !== undefined)
        && (req.orientation === undefined || ['portrait', 'landscape', 'auto'].includes(req.orientation as string))
        && (req.immersive === undefined || typeof req.immersive === 'boolean'), 'container mode');
      return;
    case 'setPlayerState':
      expect(req && (req.position !== undefined || req.playing !== undefined || req.muted !== undefined)
        && (req.position === undefined || integer(req.position, 0))
        && (req.playing === undefined || typeof req.playing === 'boolean')
        && (req.muted === undefined || typeof req.muted === 'boolean'), 'player state');
      return;
    case 'checkInputSafety':
      expect(typeof req?.text === 'string' && req.text.length > 0
        && new TextEncoder().encode(req.text).length <= 16384, 'text');
      expect(req.scene === undefined || (typeof req.scene === 'string' && /^[A-Za-z0-9_.:-]{0,64}$/.test(req.scene)), 'scene');
  }
}

const chargeStatuses = new Set(['ok', 'unauthorized', 'denied', 'unsupported', 'toy_context_unavailable', 'unavailable', 'invalid_argument']);
const dataStatuses = new Set([...chargeStatuses, 'partial', 'author_mismatch', 'video_not_found', 'video_invisible']);

function validDataStatus(value: unknown): value is string {
  return typeof value === 'string' && dataStatuses.has(value);
}

function videoSummary(value: unknown): boolean {
  const item = record(value);
  const stat = record(item?.stat);
  return !!item && integer(item.aid, 1) && typeof item.bvid === 'string'
    && typeof item.title === 'string' && typeof item.cover === 'string'
    && dimension(item.publishTime) && dimension(item.duration)
    && !!stat && ['view', 'like', 'coin', 'favorite', 'share', 'comment', 'danmaku']
      .every(key => dimension(stat[key]));
}

export function validCharge(value: unknown): boolean {
  const result = record(value);
  return Boolean(result && typeof result.status === 'string' && chargeStatuses.has(result.status)
    && (result.status !== 'ok' || typeof record(result.data)?.unlocked === 'boolean'));
}

export function validResponse(method: PromiseMethod, value: unknown): boolean {
  const result = record(value);
  switch (method) {
    case 'isSupport': return typeof value === 'boolean';
    case 'getCloudStorage':
    case 'getSharedStorage': return !!result && Object.values(result).every(item => typeof item === 'string');
    case 'getUserProfile': return !!result && typeof result.avatar === 'string' && typeof result.nickname === 'string'
      && (result.toyOpenId === undefined || typeof result.toyOpenId === 'string');
    case 'getChargeUnlock': return validCharge(value);
    case 'checkInputSafety': return !!result && (result.status === 'ok' && result.passed === true
      || (result.status === 'rejected' || result.status === 'unavailable') && result.passed === false);
    case 'getRankList': return Array.isArray(value) && value.every(item => {
      const rank = record(item);
      return !!rank && integer(rank.rank, 1) && integer(rank.score, -16777216, 16777215)
        && typeof rank.avatar === 'string' && typeof rank.nickname === 'string';
    });
    case 'getMyRank': return !!result && (result.ranked === false ? result.rank === 0 && result.score === 0
      : result.ranked === true && integer(result.rank, 1) && integer(result.score, -16777216, 16777215));
    case 'submitScore': return integer(result?.score, -16777216, 16777215);
    case 'getQrCode': return typeof result?.base64 === 'string' && typeof result.url === 'string';
    case 'saveImageToAlbum': return typeof result?.localPath === 'string';
    case 'requestCamera':
    case 'requestMicrophone': return typeof result?.getTracks === 'function';
    case 'getAuthorVideoRange': return Array.isArray(result?.items) && typeof result.hasMore === 'boolean'
      && result.items.every(item => videoSummary(item) && typeof item.isCooperation === 'boolean');
    case 'getVideoUserActions': return validDataStatus(result?.status) && Array.isArray(result?.items)
      && result.items.every(item => integer(item?.aid, 0) && typeof item.bvid === 'string' && validDataStatus(item.status));
    case 'getAuthorProfile': return validDataStatus(result?.status)
      && (result?.data === undefined || typeof record(result.data)?.nickname === 'string');
    case 'getAuthorRelation': return validDataStatus(result?.status)
      && (result?.data === undefined || typeof record(result.data)?.isFollowing === 'boolean');
    case 'getAuthorVideos': return validDataStatus(result?.status) && Array.isArray(result?.items)
      && result.items.every(item => validDataStatus(item?.status) && !!record(item.ref)
        && (item.data === undefined || videoSummary(item.data)));
    case 'getAnnualReport': return typeof result?.watch_duration === 'number'
      && Array.isArray(result.hot_arch_list) && (result.target === null || !!record(result.target));
    case 'getContainerState': {
      const viewport = record(result?.viewport);
      const area = record(result?.safeArea);
      return !!result && ['phone', 'tablet', 'desktop', 'unknown'].includes(result.deviceType as string)
        && ['landscape', 'portrait'].includes(result.orientation as string) && typeof result.immersive === 'boolean'
        && !!viewport && dimension(viewport.width) && dimension(viewport.height)
        && !!area && ['top', 'right', 'bottom', 'left'].every(edge => dimension(area[edge]))
        && Array.isArray(result.changedFields) && [...result.changedFields].every(field => typeof field === 'string');
    }
    case 'getPlayerState': return !!result && integer(result.position, 0) && integer(result.duration, 0)
      && typeof result.playing === 'boolean' && typeof result.muted === 'boolean'
      && dimension(result.rate) && integer(result.timestamp, 0) && Array.isArray(result.changedFields);
    case 'navigate':
    case 'share':
    case 'sharePicture':
    case 'closeBrowser':
    case 'openChargePanel':
    case 'setCloudStorage':
    case 'removeCloudStorage':
    case 'setSharedStorage':
    case 'removeSharedStorage':
    case 'stopMedia':
    case 'setContainerMode':
    case 'setPlayerState': return value === undefined;
    default: {
      const unhandled: never = method;
      void unhandled;
      return false;
    }
  }
}
