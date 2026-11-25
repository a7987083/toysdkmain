# v0.4 稳定性与迁移

## 运行时、会话和诊断

- 用 `toyRuntime.initialize()` 共用默认 Adapter。需要注入测试 SDK 时创建独立 `ToyRuntime({ sdk })`。并发初始化共享 Promise，显式 `dispose()` 禁用旧 Adapter，之后可重新初始化。
- 默认检测注入与公开探测函数。设置 `verifyBridge: true` 会在初始化期限内通过公开 `isSupport` 验证 Bridge 回包。宿主类型来源不足时保留 unknown。
- Adapter 默认最多跟踪 16 个真实在途请求，可配置为其他有限正整数。使用 `callWithSignal` 时 AbortSignal 只终止等待。已发出写请求若超时或被取消，检查异常的 `outcome === 'unknown'`。错误 `type` 和官方 `code` 保留，`category` 提供统一类别。
- JavaScript 调用也必须符合公开方法名单、同步订阅或异步调用分组和参数个数。返回值校验关键字段，兼容未知新增字段。
- 在业务适当的时间主动调用 `ToySession.refresh()`。每次重新核验立即撤销旧用户作用域，重新绑定 `session.storage()`、`GameLeaderboard.forSession()` 及相关 UI。只有官方返回稳定 `toyOpenId` 时才提供可持久化的本地玩家分区。可通过 `enterGuest()` 显式启用独立游客数据。调用 `watchVisibility()` 会在已有稳定身份后启用前台复查。
- `ChargeAccess` 可注入会话。自动检查会合并同一会话的重复查询，收到官方付费事件或页面恢复可见后重新核验。仍使用点击手势打开付费面板，只有官方鉴权通过才显示客户端权益。
- `adapter.telemetry.report()` 返回固定字段、有限容量的诊断。日志保留公开方法、耗时、类别和数字错误码，省略参数、原始异常及返回数据。注入 `SdkDiagnostics` 可设定环形日志容量与本地接收器。

## 云存档和榜单

- 浏览器 `Storage` 写入使用 Web Locks。没有 Web Locks 时持久化写入会返回 `cache_lock_unavailable`，可选择内存缓存或提供共享锁的自定义持久化适配器。缓存变化时用 `watchCache()` 通知并显式 `reloadCache()`。遇到 `cache_changed` 时应由游戏重新应用用户变更。
- 云同步在发送前保存操作标记，再批量读回复核。部分失败通过 `SaveSyncError.report`、`unknown` 和 `cause` 报告。下次同步先读取云端，无法确认的提交保留冲突供游戏处理，不自动重发。平台没有跨设备 CAS，账号变动无法撤回已发出的官方请求。
- `exportSlot()` 可导出原始槽位，`importSlot()` 验证校验和、迁移和 Schema。损坏缓存原样留存。已知高版本槽位拒绝低版本写入覆盖。 `measure()` 可计算实际 UTF-8 字节数。v0.3 存档封套保持兼容。
- 排行榜可选择按玩家、游戏和榜位持久化记录，失去回执或恢复到 pending 时视为 unknown，不自动重提交。记录限制为 256 条，默认保留 7 天。旧版两参数构造函数继续支持内存结算。平台没有结算幂等键，未知提交不可由当前排名推断为某个结算已成功。

## 生命周期与实机

生命周期钩子接收可选用的 AbortSignal，超时和销毁结束本地等待，函数需要自己停止在途工作。长时间挂起的旧 Hook 结束前阻止新游戏 Hook 重入，清理 Hook 仍可执行。异步 Hook 内避免等待同一实例的生命周期 API。

验证命令见 CI。实机覆盖 B站 iOS、Android、HarmonyOS、创作中心预览以及外部浏览器，重点验证授权、账号切换、Web Locks、触屏设备权限及付费事件。使用专用测试作品操作真实存档和排行榜。
