import { ToyKitError, type ToyAdapter } from '../sdk-adapter/index.js';
import type { ToySDK, PromiseMethod, SubscriptionMethod } from '../sdk-contract/index.js';
import { ToyRuntime, toyRuntime } from '../sdk-runtime/index.js';

export function createToyFacade(runtime: ToyRuntime) {
  let adapter: ToyAdapter | undefined;
  function current() {
    if (!adapter || adapter.diagnostics().disposed) throw new ToyKitError('call_ready_first');
    return adapter;
  }
  const call = <K extends PromiseMethod>(method: K) =>
    (...args: Parameters<ToySDK[K]>) => current().call(method, ...args);
  const event = <K extends SubscriptionMethod>(method: K) =>
    (listener: Parameters<ToySDK[K]>[0]) => current().subscribe(method, listener);
  return {
    async ready() { adapter = await runtime.initialize(); },
    supports: (method: keyof ToySDK) => current().supports(method),
    user: { profile: call('getUserProfile'), annualReport: call('getAnnualReport') },
    cloud: { get: call('getCloudStorage'), set: call('setCloudStorage'), remove: call('removeCloudStorage'),
      sharedGet: call('getSharedStorage'), sharedSet: call('setSharedStorage'), sharedRemove: call('removeSharedStorage') },
    rank: { submit: call('submitScore'), list: call('getRankList'), mine: call('getMyRank') },
    author: { profile: call('getAuthorProfile'), videos: call('getAuthorVideos'), relation: call('getAuthorRelation') },
    video: { actions: call('getVideoUserActions'), state: call('getPlayerState'), set: call('setPlayerState'), onChange: event('onPlayerChange') },
    share: { open: call('share'), picture: call('sharePicture'), qr: call('getQrCode'), saveImage: call('saveImageToAlbum') },
    container: { state: call('getContainerState'), mode: call('setContainerMode'), onChange: event('onContainerChange'),
      navigate: call('navigate'), close: call('closeBrowser'), onClose: event('onPageClose') },
    media: { camera: call('requestCamera'), microphone: call('requestMicrophone'), stop: call('stopMedia') },
    charge: { check: call('getChargeUnlock'), open: call('openChargePanel'), onChange: event('onChargeUnlockChange') },
    safety: { check: call('checkInputSafety') },
  };
}
export const toy = createToyFacade(toyRuntime);
