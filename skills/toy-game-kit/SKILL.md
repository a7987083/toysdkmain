---
name: toy-game-kit
description: Build and test Bilibili Toy games with ToyGameKit, including host sessions, scoped saves, scores, input safety and package preflight.
---

先读工程 AGENTS.md、package.json、提供的 SDK 版本和声明。读取 references/api.md 选择真实接口；存储看 storage.md，内容或付费看 compliance.md，打包看 deployment.md。

启动前选择官方或显式测试入口。等待 ready 后才开放按钮；手势调用在点击栈内直接开始。账号未知时暂停个人操作。手动选择本地游客后明确告知持久化边界。按业务节点批量存档，分数按结算 ID 提交。权限失败或能力未知时保留基础游戏。不得重写 Adapter、自动 Mock 或猜测 App 版本支持。

验收时运行仓库回归和独立模板测试，查看 evals/README.md。真实测试只用专用 Toy。报告写清使用的提交、构建产物哈希、测试环境，以及仍待真机确认的行为。
