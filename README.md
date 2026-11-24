# ToyGameKit

面向 B站 Toy 游戏的 TypeScript SDK 适配层和显式 Mock，目前在 `dev` 开发。

## 开发

```sh
npm ci --ignore-scripts
npm test
```

构建产物在 `dist/`。生产页面加载官方 CDN 提供的 Toy SDK，随后创建 Adapter。

```js
import { ToyAdapter } from './sdk-adapter/index.js';

const sdk = await ToyAdapter.waitForWindow();
const data = await sdk.call('getCloudStorage');
```

对需要用户手势的接口，提前初始化 Adapter，再在点击处理器内直接调用。Mock 仅由开发者显式注入。接口基线和使用限制见 [SDK 开发文档](docs/sdk.md)。
