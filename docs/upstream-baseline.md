# 官方 Toy SDK 核对基线

- 接口文档版本：2026-11-17。公开方法 37 个，其中 4 个同步订阅方法返回取消函数。
- CDN：<https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js>
- SDK 0.5.5，JSBridge 3.3.3，降级适配器 3.3.1，UMD，145403 字节。
- CDN 与用户提供的样本一致。SHA-256：`b2714a2282239c400585daba0259695165222763247e0369cee9fdc49d7afac9`。
- 官方创作者工具基线：[bilibili/toy@885124fe](https://github.com/bilibili/toy/tree/885124fe47f2550e2f5b8783480cdd5f00c0a392)。已核对发布技能与自检规则。解压后的入口 HTML 上限为 1 MiB，资源应兼容 Toy 子路径。
- 官方网页文档入口由客户端渲染。以提供的文档快照及 CDN 源码交叉核对。源码以静态方式检查。部分作者接口仅透传服务端数据，且附带文档未展开字段，契约保留未知结构。
