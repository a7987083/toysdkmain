export type Unsubscribe = () => void;
export type NavigateRequest = {
  type: 'video' | 'space' | 'search' | 'opus' | 'tribee' | 'toy';
  id: string;
  extra?: Record<string, string>;
};
export type ImageRequest =
  | { url: string; base64Data?: string }
  | { url?: undefined; base64Data: string };

export type VideoRef = { aid: number; bvid?: never } | { bvid: string; aid?: never };
export type VideoActionsQuery = { aids: number[]; videos?: never } | { videos: VideoRef[]; aids?: never };
export type VideoRangeQuery = { start?: number; end?: number };
export type ServiceResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthorized' | 'denied' | 'unsupported' | 'toy_context_unavailable' | 'unavailable' | 'invalid_argument' };
export type ChargeUnlockResp = ServiceResult<{ unlocked: boolean }>;
export type AuthorProfileResp = ServiceResult<{ nickname: string; follower: number } & Record<string, unknown>>;
export type AuthorRelationResp = ServiceResult<{ isFollowing: boolean; hasFanMedal: boolean } & Record<string, unknown>>;
export type AuthorVideosResp = Record<string, unknown>; // The SDK forwards the undocumented server envelope.

export interface AuthorRangeVideo {
  aid: number;
  bvid: string;
  title: string;
  cover: string;
  publishTime: number;
  duration: number;
  stat: Record<string, number>;
  isCooperation: boolean;
}

export type AuthorVideoRange = { items: AuthorRangeVideo[]; hasMore: boolean };
export type AuthorVideo = { title: string; cover: string } & Record<string, unknown>;
export type VideoUserAction = { aid: number; bvid: string; ref?: VideoRef } & (
  | { status: 'ok'; liked: boolean; coinCount: number; favorited: boolean }
  | { status: 'not_found' | 'unavailable' | 'unsupported' | 'denied' }
);
export type VideoUserActionsResp = { status: string; items: VideoUserAction[] };

export interface AnnualReport {
  target: { nickname: string; avatar: string } | null;
  first_watch_date: number | null;
  first_watch_video: AuthorVideo | null;
  watch_duration: number;
  watch_percentile: number;
  watch_month_cnt: number;
  duration_ratio: number;
  old_arch_cnt: number | null;
  oldest_arch_date: number | null;
  oldest_arch_video: AuthorVideo | null;
  chase_arch_cnt: number | null;
  live_join_cnt: number;
  up_arch_cnt: number | null;
  up_live_cnt: number;
  n_watch_video: AuthorVideo | null;
  n_watch_last_date: number | null;
  n_watch_cnt: number | null;
  likes_cnt: number | null;
  elec_cnt: number | null;
  coin_cnt: number | null;
  interact_cnt: number | null;
  up_like_cnt: number | null;
  up_reply_cnt: number | null;
  up_main_area: string | null;
  resonance_video: AuthorVideo | null;
  hot_arch_list: Array<{
    type: number;
    video?: AuthorVideo;
    watch_date?: number;
    live?: {
      live_key: string;
      room_id: number;
      title: string;
      cover: string;
      jump_url: string;
      status: number;
      replay_bvid?: string;
    };
  }>;
  fans: {
    medal: { name: string; level: number; is_light: boolean } | null;
    guard_level: number;
    accompany_days: number;
  } | null;
}

export type ContainerMode = { orientation?: 'portrait' | 'landscape' | 'auto'; immersive?: boolean };
interface ContainerSnapshot {
  deviceType: 'phone' | 'tablet' | 'desktop' | 'unknown';
  viewport: { width: number; height: number };
  orientation: 'portrait' | 'landscape';
  immersive: boolean;
  safeArea: { top: number; right: number; bottom: number; left: number };
}
export type ToyContainerState = ContainerSnapshot & { changedFields: Array<keyof ContainerSnapshot> };
export type PlayerChange = { position?: number; playing?: boolean; muted?: boolean };
interface PlayerSnapshot {
  position: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  rate: number;
}
export type ToyPlayerState = PlayerSnapshot & { timestamp: number; changedFields: Array<keyof PlayerSnapshot> };
export type CheckInputSafetyResp = { status: 'ok'; passed: true } | { status: 'rejected' | 'unavailable'; passed: false };

export interface ToyPlatformSDK {
  navigate(req: NavigateRequest): Promise<void>;
  saveImageToAlbum(req: ImageRequest & { hintMsg?: string }): Promise<{ localPath: string }>;
  share(req: { path: string }): Promise<void>;
  getQrCode(req?: { path?: string; size?: number }): Promise<{ base64: string; url: string }>;
  sharePicture(req: ImageRequest): Promise<void>;
  closeBrowser(): Promise<void>;
  getAuthorProfile(): Promise<AuthorProfileResp>;
  getAuthorVideos(req: { videos: VideoRef[] }): Promise<AuthorVideosResp>;
  getAuthorVideoRange(req?: VideoRangeQuery): Promise<AuthorVideoRange>;
  getAuthorRelation(): Promise<AuthorRelationResp>;
  getVideoUserActions(req: VideoActionsQuery): Promise<VideoUserActionsResp>;
  getAnnualReport(req: { edition: string }): Promise<AnnualReport>;
  getChargeUnlock(req: { minPrice: number }): Promise<ChargeUnlockResp>;
  openChargePanel(req: { minPrice: number }): Promise<void>;
  onChargeUnlockChange(listener: (result: ChargeUnlockResp) => void): Unsubscribe;
  requestCamera(options?: { facingMode?: 'user' | 'environment' }): Promise<MediaStream>;
  requestMicrophone(): Promise<MediaStream>;
  stopMedia(stream: MediaStream): Promise<void>;
  onContainerChange(listener: (state: ToyContainerState) => void): Unsubscribe;
  getContainerState(): Promise<ToyContainerState>;
  setContainerMode(req: ContainerMode): Promise<void>;
  onPlayerChange(listener: (state: ToyPlayerState) => void): Unsubscribe;
  getPlayerState(): Promise<ToyPlayerState>;
  setPlayerState(req: PlayerChange): Promise<void>;
  onPageClose(listener: () => void): Unsubscribe;
  checkInputSafety(req: { text: string; scene?: string }): Promise<CheckInputSafetyResp>;
}
