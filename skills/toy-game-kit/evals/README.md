# 行为验收

| 场景 | 可执行证据或人工条件 |
|---|---|
| 贪吃蛇吃到食物、保存与结算 | 模板 Chromium 测试点击右键取得一分，保存并结算；模板 npm test 在新 Context 中恢复分数 |
| Phaser 横向画布 | 模板 Chromium 测试实际启动动态加载的 Phaser；在专用 Toy 横屏切前台再验证尺寸 |
| 安全区 | game-services 的 viewport 测试检查 CSS inset；刘海和底部系统栏需实机 |
| 登录失败降级 | followup、repair 中身份与游客隔离断言；真机拒绝授权后验证基础玩法 |
| 充电附加权益 | game-services、repair 的权限事件乱序、合并与手势；基础游戏无需打开充电面板 |
| 输入审核拒绝 | repair 的 allowsInput 测试覆盖 rejected、unavailable、异常、未知字段 |
| 媒体手势与释放 | followup 的同栈手势和 repair 的释放失败；系统权限提示须真机验收 |
| 断网和限流 | repair、contract 的写入 unknown、307044、读取有限重试；Lab Mock 可注入 |
| 发布预检 | CI 对模板实际 ZIP、Lab 和消费端执行固定 Doctor；预览与审核人工确认 |
