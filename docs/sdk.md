# SDK 开发

- `sdk-contract` 包含 37 个公开方法的类型与运行时名单。订阅方法为同步接口，通过 `adapter.subscribe` 调用，其余方法通过 `adapter.call` 调用。
- `sdk-adapter` 保留现有云存档、资料和排行榜快捷方法。通过 `supports` 主动探测能力。需要平台手势的调用在调用栈内直接发给官方 SDK，避免在点击后的官方调用前等待探测。
- `ToyKitError.type` 表示错误类型，`code` 保留上游数字错误码。超时只结束当前等待，底层请求可能继续执行。可显式使用 `readWithBackoff` 重试有限次数的榜单或存档读取限流，重复的在途分数提交会被拒绝。
- `dispose` 取消托管订阅并释放媒体轨道。对于 B站 App 页面关闭事件，写存档应安排在结算等业务节点。
- `MockSDK` 支持 App、Web、预览和外部浏览器场景，并可注入结果、限流或挂起请求。周榜按上海时区周一开始，属于 Mock 的日历约定，线上周期边界待实测。部分接口通过显式 fixtures 提供成功数据。
- 充电要以 `getChargeUnlock` 的 `status === 'ok' && data.unlocked` 判断，只用于前端显示控制。输入检测只有 `status === 'ok' && passed` 才能放行。
- 部分作者接口的服务端数据结构在 2026-11-17 文档未展开，当前类型只建模已知字段，`getAuthorVideos` 返回对象的字段需自行收窄。部分复杂响应当前仅检查顶层形状。B站真实平台兼容性仍需实测。

官方 SDK 位于 [CDN](https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js)，核对记录见 [upstream-baseline.md](upstream-baseline.md)。
