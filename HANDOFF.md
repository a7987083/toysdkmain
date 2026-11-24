# Handoff

开发分支为 `dev`。初始化基线为 `1d7ccfda3a20cb2568535871f89302787bf3f356`，构建与 CI 基线为 `a0589f6992e71eebae98c159f9ca60663eee6bc3`。当前代码位置见 `packages/sdk-contract`、`packages/sdk-adapter`、`packages/sdk-mock`。

使用 Node 24，运行 `npm ci --ignore-scripts` 和 `npm test`。SDK CI 在 dev 和 main 的 push 与 pull request 触发。首个 [CI 运行](https://github.com/a7987083/toysdkmain/actions/runs/45401140938) 已通过。后续提交状态以 Actions 为准。

B站实机环境的授权、媒体、充电和预览行为尚未验证。核对文档未展开的作者响应及事件字段后，再发布稳定契约。
