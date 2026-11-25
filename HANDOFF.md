# Handoff

开发分支为 `dev`。初始化基线为 `1d7ccfda3a20cb2568535871f89302787bf3f356`，构建与 CI 基线为 `a0589f6992e71eebae98c159f9ca60663eee6bc3`。当前代码位置见 `packages/sdk-contract`、`packages/sdk-adapter`、`packages/sdk-mock`。

使用 Node 24，运行 `npm ci --ignore-scripts` 和 `npm test`。SDK CI 在 dev 和 main 的 push 与 pull request 触发。首个 [CI 运行](https://github.com/a7987083/toysdkmain/actions/runs/45401140938) 已通过。后续提交状态以 Actions 为准。

B站实机环境的授权、媒体、充电和预览行为尚未验证。已有官方类型基线，需要对照真实宿主响应与事件，验证后再发布稳定契约。

使用 `npm run sdk:check` 核对四类官方上游。报告位于 `dist/sdk-monitor/`，维护步骤与触发条件见 [SDK 更新监控](docs/sdk-monitor.md)。已在实验室提交 `27c166a` 通过 CI。

测试实验室在 `examples/sdk-test-lab/`。用 `npm run lab:build` 生成静态站点，SDK CI 附带可上传 ZIP。平台实测场景与记录方法见 [SDK 实验室](docs/sdk-test-lab.md)。

公共 SDK 位于 `packages/game-core`、`packages/game-storage`、`packages/game-platform`，用法及事务边界见 [游戏公共 SDK](docs/game-services.md)。下一步覆盖统一输入并跑真实 Toy 验证。

## 0.4.0-dev.0 稳定性工作

基线为 `ab3f536`，上次通过的 [基线 Actions](https://github.com/a7987083/toysdkmain/actions/runs/45404952775)。本地基线 26 项测试通过。当前候选新增稳定性回归和 TGZ 消费端测试。实验环境的 Chromium 启动器缺少浏览器可执行文件，浏览器实测以 GitHub Actions 的 Chromium 步骤为准。上游 CDN 0.5.5 保持一致，在线声明差异见 [官方核对记录](docs/upstream-baseline.md)。

新入口和行为边界见 [稳定性迁移指南](docs/stability.md)。下步在真实设备核对账号切换、Web Locks、权限和 SDK 容器行为。

## 0.4.2 候选

从 dev 的 0.4.2-dev.0 继续。运行 npm ci --ignore-scripts、npm test，产物和消费端命令见 CI。实机验收优先覆盖账号切换、存档迟到回包、真实 Web Locks、充电、旋转、媒体及审核。 [验收与恢复说明](docs/repair-0.4.md)
