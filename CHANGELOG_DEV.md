# Development changelog
## 0.1.0-dev.0
Initial typed contract subset, adapter, explicit isolated mock and regression test source. Not yet verified by CI.

## v0.1 构建基线

- 锁定 TypeScript 5.9.3，配置 Node 24 CI。
- 原工程已实际编译，原有 3 项测试通过。
- 记录官方 SDK 样本及创作者工具版本。

## v0.1 SDK 接口

- 增加全部 37 个文档化方法的类型与调用入口，保留原 Adapter 快捷方法。
- Adapter 增加显式能力探测、参数和关键返回值校验、错误分类、超时、在途限制、读取退避、分数去重和资源释放。
- Mock 增加周期榜、授权和异常注入、充电与容器事件。新增契约与回归测试。

- 从官方文档页面的类型声明核对作者资料、视频与互动状态，补齐对应契约和回归测试。

## v0.2 上游监控

- 增加官方 CDN、文档、仓库和 CLI 发布元数据的联网核对、SDK 离线导入和差异报告。
- 建立 Stable 元数据和候选审核工作流，监控推送结果作为 Artifact，默认分支启用后可进行定时检查。

## SDK 实验室

- 创建 37 个公开方法的手动测试页，支持官方 SDK 和显式 Mock、事件解订阅、媒体释放及诊断导出。
- CI 打包实验室 ZIP，使用官方 Doctor 静态验证。
