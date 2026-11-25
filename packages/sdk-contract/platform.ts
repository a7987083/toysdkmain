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
export type ToyDataStatus =
  | 'ok' | 'partial' | 'unauthorized' | 'denied' | 'unsupported' | 'toy_context_unavailable'
  | 'author_mismatch' | 'video_not_found' | 'video_invisible' | 'unavailable' | 'invalid_argument';
export type ToyItemStatus = Exclude<ToyDataStatus, 'partial'>;

export type ChargeUnlockResp =
  | { status: 'ok'; data: { unlocked: boolean } }
  | { status: 'unauthorized' | 'denied' | 'unsupported' | 'toy_context_unavailable' | 'unavailable' | 'invalid_argument' };

export interface AuthorProfile {
  nickname: string;
  avatar: string;
  sign: string;
  certification?: { role: number; title: string; description: string; type: number };
  following: number;
  follower: number;
  archiveCount: number;
  charging?: { count: number; display?: { show: boolean; text?: string } };
  fanMedal?: {
    name: string;
    enabled: boolean;
    levels: Array<{ level: number; minIntimacy: number; maxIntimacy?: number }>;
  };
  birthday?: number;
}

export type AuthorProfileResp = { status: ToyDataStatus; data?: AuthorProfile };

interface VideoStats {
  view: number;
  like: number;
  coin: number;
  favorite: number;
  share: number;
  comment: number;
  danmaku: number;
}

interface VideoSummary {
  aid: number;
  bvid: string;
  title: string;
  cover: string;
  publishTime: number;
  duration: number;
  stat: VideoStats;
}

export type AuthorRangeVideo = VideoSummary & { isCooperation: boolean };
export type AuthorVideoRange = { items: AuthorRangeVideo[]; hasMore: boolean };
export interface AuthorVideo extends VideoSummary {
  description: string;
  partition?: string;
  pages: Array<{ page: number; title: string; duration: number }>;
  pay: { chargingPay: boolean; paid: boolean };
  seasonId?: number;
  rank?: { now: number; highest: number };
}
export type AuthorVideosResp = {
  status: ToyDataStatus;
  items: Array<{ ref: VideoRef; status: ToyItemStatus; data?: AuthorVideo }>;
};

export interface AuthorRelation {
  isFollowing: boolean;
  isAuthor: boolean;
  isOldFan: boolean;
  hasFanMedal: boolean;
  fanMedalName?: string;
  fanMedalLevel?: number;
  isFanMedalActive?: boolean;
  isCharging: boolean;
  followTime?: number;
}
export type AuthorRelationResp = { status: ToyDataStatus; data?: AuthorRelation };

export interface VideoUserAction {
  aid: number;
  bvid: string;
  ref?: VideoRef;
  status: ToyItemStatus;
  liked?: boolean;
  coinCount?: number;
  favorited?: boolean;
}
export type VideoUserActionsResp = { status: ToyDataStatus; items: VideoUserAction[] };

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
export interface ContainerSnapshot {
  deviceType: 'phone' | 'tablet' | 'desktop' | 'unknown';
  viewport: { width: number; height: number };
  orientation: 'portrait' | 'landscape';
  immersive: boolean;
  safeArea: { top: number; right: number; bottom: number; left: number };
}
export type ToyContainerState = ContainerSnapshot & { changedFields: Array<keyof ContainerSnapshot> };
export type PlayerChange = { position?: number; playing?: boolean; muted?: boolean };
export interface PlayerSnapshot {
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
