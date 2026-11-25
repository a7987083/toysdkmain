import type { ToyAdapter } from '../sdk-adapter/index.js';
import type { ContainerMode, ToyContainerState, Unsubscribe } from '../sdk-contract/index.js';

type BrowserViewport = Pick<Window, 'innerWidth' | 'innerHeight' | 'addEventListener' | 'removeEventListener'>;

export interface GameLayout extends Omit<ToyContainerState, 'changedFields'> {
  source: 'toy' | 'browser';
}

export class GameViewport {
  constructor(
    private readonly adapter: ToyAdapter,
    private readonly browser: BrowserViewport | null = globalThis.window ?? null,
  ) {}

  /** Observe host state when available, and use browser dimensions until the first host event. */
  watch(listener: (layout: GameLayout) => void): Unsubscribe {
    let active = true;
    let offHost: Unsubscribe | undefined;
    const browser = this.browser;
    const onResize = () => {
      if (browser && active) listener({
        source: 'browser',
        deviceType: 'unknown',
        viewport: { width: browser.innerWidth, height: browser.innerHeight },
        orientation: browser.innerWidth > browser.innerHeight ? 'landscape' : 'portrait',
        immersive: false,
        safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    };
    onResize();
    browser?.addEventListener('resize', onResize);
    let observedEvent = false;
    let last: string | undefined;
    const publish = (state: ToyContainerState) => {
      if (!active) return;
      browser?.removeEventListener('resize', onResize);
      const { deviceType, viewport, orientation, immersive, safeArea } = state;
      const layout = { source: 'toy' as const, deviceType, viewport, orientation, immersive, safeArea };
      const signature = JSON.stringify(layout);
      if (signature === last) return;
      last = signature;
      listener(layout);
    };
    const attach = async () => {
      if (!(await this.adapter.supports('onContainerChange')) || !active) return;
      offHost = this.adapter.subscribe('onContainerChange', state => {
        observedEvent = true;
        publish(state);
      });
      if (!active) offHost();
    };
    const subscription = attach().catch(() => {});
    void this.adapter.call('getContainerState').then(async state => {
      await subscription;
      if (!observedEvent) publish(state);
    }).catch(() => {});
    return () => {
      if (!active) return;
      active = false;
      browser?.removeEventListener('resize', onResize);
      offHost?.();
    };
  }

  /** A successful request still needs confirmation from a matching host layout event. */
  requestMode(mode: ContainerMode): Promise<void> {
    return this.adapter.call('setContainerMode', mode);
  }
}

export function applySafeArea(style: Pick<CSSStyleDeclaration, 'setProperty'>, layout: GameLayout): void {
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const value = layout.source === 'toy' && Number.isFinite(layout.safeArea[edge]) && layout.safeArea[edge] >= 0 ? `${layout.safeArea[edge]}px` : `env(safe-area-inset-${edge}, 0px)`;
    style.setProperty(`--toy-safe-area-${edge}`, value);
  }
}
