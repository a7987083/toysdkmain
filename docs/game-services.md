# 游戏公共 SDK

从 `toy-game-kit` 或相应子路径导入。开发版可用 `npm pack` 构建本地测试用 TGZ。

## 生命周期

```ts
const lifecycle = new GameLifecycle(config, {
  start: config => game.start(config),
  pause: () => game.pause(),
  resume: () => game.resume(),
  dispose: () => game.destroy(),
});

await lifecycle.start();
```

浏览器隐藏时自动暂停，回到前台时仍保留游戏主动发出的暂停。监听 `onStateChange` 和 `onError` 可更新 UI 或收集错误。销毁会移除可见性监听。生命周期钩子应由游戏执行实际操作，避免在钩子中等待同一实例的另一个生命周期操作。

## 存档

```ts
type Save = { level: number };
const storage = new GameStorage<Save>({
  namespace: 'demo-rpg',
  schema: {
    version: 1,
    validate: (value): value is Save =>
      typeof value === 'object' && value !== null && 'level' in value && Number.isInteger(value.level),
  },
  session: { mode: 'cloud', playerKey: localProfileKey, cloud: toyCloud(adapter) },
  cache: localStorage,
});

await storage.sync(['main']);
const previous = storage.get('main');
await storage.put('main', { level: (previous?.level ?? 0) + 1 });
const result = await storage.sync(['main']);
```

- `put` 和 `remove` 先写本地缓存，可在结算或过关时批量同步。传入 `cache` 后，待写队列可在重新打开时恢复。相同缓存分区应使用单个活动实例，跨标签页同时写本地缓存未加锁。
- 独立的游客模式仅使用本地缓存。登录时用玩家的本地缓存标识创建新实例，切换账号前先调用旧实例的 `close()` 并等待在途操作。挂起的底层 SDK 请求仍可能在等待超时后继续执行。 `playerKey` 仅用于本地隔离，不作为平台鉴权。游戏可自行选择是否迁移游客存档。
- 用 `sharedCloud(adapter, storageId)` 接入官方共享存档。跨作品共享同一份数据时应使用一致的命名空间和 Schema。
- `sync` 写入前检查已知的云端快照。出现 `conflicts` 时，游戏可展示 `get(key)` 和 `conflict(key)` 的两份数据，通过 `resolve(key, 'local' | 'cloud')` 选择后再同步。平台没有 CAS，读写之间仍可能发生并发覆盖。
- 版本由 `schema.version` 定义，`migrations` 按旧版本逐步迁移。读取损坏槽位会报 `corrupt_save`，可显式替换或删除。完整编码后的单值上限为 1024 UTF-8 字节，包含封套开销。校验和用于识别意外损坏，客户端存档仍需按不可信输入处理。

## 排行榜与充电

- `GameLeaderboard(adapter, board)` 提供周期榜单、个人名次和结算提交。传入游戏生成的稳定结算 ID，单实例内会合并相同结算的在途提交并保留最近完成的记录。
- `ChargeAccess(adapter, minPrice)` 默认门槛 1200 分。点击时直接调用 `openPanel()`，回到页面通过 `watchVisibility()` 重新核验，或者由宿主主动调用 `refresh()`。仅最新有效响应能将 `unlocked` 设为真。组件卸载时调用 `dispose()`。此状态用于界面展示，受保护的资源仍需服务端授权。

## 容器与安全区

`GameViewport.watch` 先提供浏览器尺寸，收到 B站容器事件后使用宿主状态。页面可用 `applySafeArea(element.style, layout)` 设置 `--toy-safe-area-*` CSS 变量。调用 `requestMode` 后通过后续容器事件确认方向和沉浸状态。取消监听函数可在场景卸载时调用。
