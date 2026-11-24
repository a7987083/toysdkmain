# 官方 SDK 更新监控

```sh
npm ci --ignore-scripts
npm run sdk:check
npm run sdk:check -- --sdk /path/to/toy-sdk.js
```

联网检查 SDK CDN、SDK 文档声明、官方 GitHub 创作者工具提交和官方 CLI 版本及 Linux x64 归档校验值。离线导入仅检查给定的本地 SDK 文件，不联网。候选数据和差异写到 `dist/sdk-monitor/candidate.json`、`diff.json`。CI 保存报告 Artifact。

监控以 SHA-256 识别 SDK 文件变化，静态解析挂载到 `window.toy` 的方法列表。公开契约依据文档中的类型声明，比较方法签名及其引用的类型声明指纹，JS 独有的方法只作为诊断。声明变更、文档日期、仓库和 CLI 归档也分别记录。检查不会执行下载的 JS、安装 CLI 或覆盖 `upstream/stable/manifest.json`。

若因上游改变打包方式无法提取，任务失败并保留 Stable。检测到新版本后，审查报告，核对行为与权限，运行编译、契约测试和真实 Toy 验证，再手动推进 Stable。CLI 命令行为应按官方技能在独立环境通过 `toy --help-json` 对照。线上 CDN 未固定版本，框架回滚不能保证 CDN 同时回滚。

GitHub Actions 的定时和手动触发依赖默认分支中存在该 workflow。当前开发在 `dev`，先通过该分支的监控 push 检查和本地运行验证。定时任务发现变化后按指纹去重创建审查 Issue。
