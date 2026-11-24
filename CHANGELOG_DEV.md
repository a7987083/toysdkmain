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
