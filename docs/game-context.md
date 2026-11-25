# 接入与所有权

业务启动时 `await toy.ready()`。在 click 回调中直接执行 `toy.media.camera()` 或 `toy.charge.open({minPrice:1200})`，初始化与探测放在注册按钮之前。未就绪会同步抛出 call_ready_first。Facade 全部方法和 TS 参数由 game-context/facade.ts 及 npm 包中的声明提供，tests/followup.test.mjs 验证与公开契约的覆盖；旧 Adapter 接口继续可用。toy.cloud 直接访问原始键值；GameStorage 提供版本封套、迁移、缓存和冲突恢复。

```js
import {createToyGame} from 'toy-game-kit';
const game = await createToyGame({namespace:'scores',storage:{
  schema:{version:1,validate:Number.isSafeInteger},cache:localStorage
}});
await game.session.refresh();
if (game.session.current.status === 'user' && game.session.current.persistentIdentity) {
  await game.storage.put('level',1);
  await game.storage.sync(['level']);
}
await game.dispose();
```

Context 默认拥有新 Runtime。传入 runtime 则仅借用，由创建者最后释放。按需访问 storage、leaderboard(board)、charge、viewport、lifecycle、diagnostics。生命周期必须显式提供 game.config 和 hooks。游客模式通过 enterGuest 进入，不自动假设身份。旧作用域在换号后拒绝使用；从 Context 重新取服务。错误分类、授权规则、无锁时的处理见 repair-0.4.md。

可选榜单 readTtlMs 范围 0 至 86400000 毫秒，默认关闭。使用 forSession 关联身份，listCacheState 标记 missing/fresh/expired；list(options,{refresh:true}) 和 mine(period,{refresh:true}) 跳过缓存。结算成功清理缓存。周期变更时间由平台决定，需要即时数据时强制刷新。

## 发布与回滚

SDK npm 包保持 private。registry 的 latest 查询返回 404，名称及账号授权尚未获得，当前仅消费 CI 生成的精确版本 TGZ。dev 用于开发，rc 需要明确验收范围，stable 受设备验收门槛约束。核对工作流对应提交和 SHA256SUMS 后在独立工程安装指定 TGZ；回滚时显式安装上一版本 TGZ 和配套锁文件，并验证高版本存档保护。SDK 的回滚不能回滚官方 CDN。若未来批准 Release，仅在同一条通过 CI 的提交上创建与 package.json 一致的 tag，复用该次产物。禁止推送后自动发布 npm。

官方 CLI v0.6.6 已使用已核验二进制读取 --help-json。预览需要单独授权上传。按实际 CLI 自描述选 create 或 update，必须携带 ZIP；先固定目标 Toy ID/slug、标题、分类、权限、封面/图标及所有文件 SHA-256。调用带 --json，预览时不传 --yes，不透传任意参数。保存返回的预览链接，与目标、包和元信息一起请用户明确确认。任何字段或文件变化重新预览；确认后再由有权限的发布者提交。凭据仅由 CLI 在本地管理。

默认分支未启用监控。待批准的最小合并范围为监控 workflow、其脚本、锁定 TS 的 package/lock 和 stable 清单；无需合并 SDK 游戏代码。监控通过 Git ref 检查上游提交，候选差异与失败存为 Artifact；禁止自动晋升 Stable。
