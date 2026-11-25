# 从候选 SDK 创建游戏

在 SDK 仓库根目录运行下面的命令。最后一个参数是通过 CI 的 TGZ，本地生成的目标目录必须尚未存在。脚手架会校验 TGZ 文件名及锁文件 SHA-512。将 vanilla-ts 改成 phaser 可创建横向画布示例。SDK 通过 vendor 中锁定的 npm 压缩包安装。

```sh
node scripts/create-game.mjs vanilla-ts ./my-game ./toy-game-kit-0.6.0-dev.0.tgz
cd my-game
npm ci --ignore-scripts
npm test
npm run dev:mock
```

正式构建运行 npm run build 和 npm run pack，交付 game.zip。Node 24，TypeScript 5.9.3，Vite 8.3.8，WebView 目标 ES2020；Phaser 模板使用 Phaser 3.90.0。版本支持需真机验证。Mock 构建单独输出 dist-mock。两个模板都可开始、计分、保存和结算，游客只使用本地存档。贪吃蛇按方向按钮前进一步；Phaser 中点击圆形目标得分。随模板附项目 CI 和 Doctor。官方宿主、付费、媒体和账号切换的人工验收见 device-acceptance.md。

核对的参考提交为 imba97/bilibili-toy@aaf64da（MIT）、imba97/bilibili-toy-starter@53fff3b（MIT）、Playgama/bridge@f5c0072（LGPL-3.0）和 Olivia295/toy-maker@d311013（MIT）。分别参考接口组织、模板使用流程、模块边界和评测场景。本项目独立实现这些功能。
