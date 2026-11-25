export * from './facade.js';
import { ToyRuntime, type RuntimeOptions } from '../sdk-runtime/index.js';
import { ToySession } from '../sdk-session/index.js';
import { GameStorage, type SaveOptions } from '../game-storage/index.js';
import { GameLeaderboard, ChargeAccess, GameViewport } from '../game-platform/index.js';
import { GameLifecycle, type GameHooks } from '../game-core/index.js';
import type { Board } from '../sdk-contract/index.js';

export interface GameOptions<T, Config> {
  namespace: string;
  runtime?: ToyRuntime;
  runtimeOptions?: RuntimeOptions;
  storage?: Pick<SaveOptions<T>, 'cache' | 'schema' | 'locks'>;
  game?: { config: Config; hooks: GameHooks<Config> };
}

export async function createToyGame<T, Config>(options: GameOptions<T, Config>) {
  if (!options.namespace || (options.runtime && options.runtimeOptions)) throw new Error('invalid_game_options');
  const runtime = options.runtime ?? new ToyRuntime(options.runtimeOptions);
  let cleanup: Promise<void> | undefined;
  const resources: (() => void | Promise<void>)[] = [];
  if (!options.runtime) resources.push(() => runtime.dispose());
  function dispose() {
    if (!cleanup) cleanup = Promise.resolve().then(async () => {
      const failures = [];
      for (const close of resources.reverse()) {
        try { await close(); } catch (error) { failures.push(error); }
      }
      resources.length = 0;
      if (failures.length) throw new AggregateError(failures, 'game_cleanup_failed');
    });
    return cleanup;
  }
  const active = () => { if (cleanup) throw new Error('game_disposed'); };
  try {
    const adapter = await runtime.initialize();
    const session = new ToySession(adapter);
    resources.push(() => session.dispose());
    let saves: GameStorage<T> | undefined;
    const boards = new Map<Board,GameLeaderboard>();
    let charge: ChargeAccess | undefined;
    let viewport: GameViewport | undefined;
    let lifecycle: GameLifecycle<Config> | undefined;
    let generation = session.current.generation;
    const closing = new Set<Promise<void>>();
    function retireStorage() {
      if (!saves) return;
      const result = saves.close();
      closing.add(result);
      void result.then(() => closing.delete(result), () => {});
      saves = undefined;
    }
    resources.push(async () => { retireStorage(); await Promise.all(closing); });
    resources.push(session.onChange(state => {
      if (generation !== state.generation) {
        generation = state.generation;
        retireStorage();
        for (const board of boards.values()) board.clearReadCache();
        boards.clear();
      }
    }));
    return {
      session, diagnostics: adapter.telemetry, dispose,
      get storage() {
        active();
        if (!options.storage) throw new Error('storage_not_configured');
        const scope = session.storage();
        return saves ??= new GameStorage({ ...options.storage, namespace: options.namespace, session: scope });
      },
      leaderboard(board: Board = 1) {
        active();
        const playerKey = session.cacheIdentity();
        let value = boards.get(board);
        if (!value) {
          value = new GameLeaderboard(adapter, board, {gameKey: options.namespace, playerKey, checkSession: session.scope(),
            storage: options.storage?.cache ?? memoryStore(), locks: options.storage?.locks});
          boards.set(board, value);
        }
        return value;
      },
      get charge() {
        active();
        if (!charge) { charge = new ChargeAccess(adapter, 1200, session); resources.push(() => charge!.dispose()); }
        return charge;
      },
      get viewport() {
        active();
        if (!viewport) { viewport = new GameViewport(adapter); resources.push(() => viewport!.dispose()); }
        return viewport;
      },
      get lifecycle() {
        active();
        if (!options.game) throw new Error('hooks_not_configured');
        if (!lifecycle) {
          lifecycle = new GameLifecycle(options.game.config, options.game.hooks);
          resources.push(() => lifecycle!.dispose());
        }
        return lifecycle;
      },
    };
  } catch (error) {
    try { await dispose(); } catch (cause) { throw new AggregateError([error,cause], 'game_initialization_failed'); }
    throw error;
  }
}
function memoryStore() {
  const values = new Map<string,string>();
  return {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => { values.set(key,value); }};
}
