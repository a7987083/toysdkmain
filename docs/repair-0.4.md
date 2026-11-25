# 0.4.2-dev.0 核对与验收

核对日期 2026-11-26（东京）。官方 SDK 0.5.5，145403 字节，SHA-256 `b2714a2282239c400585daba0259695165222763247e0369cee9fdc49d7afac9`。创作中心在线声明标记 2026-11-17，声明 SHA-256 `063ad2c0a95e61b332d65b4c2b25c431df29f251f533b431003ec7576a895144`。在线资源同时供 SDK 文档和 FAQ 使用。官方工具提交 `f418536cc463ad598a775bc1ad6cfb0505905ab7`。Doctor 按 MIT 许可使用，执行前校验脚本，具体哈希见 scripts/preflight.sh。历史 Stable 快照保留。

| 方法 | 与历史签名比较 | CDN | 调用策略 |
|---|---|---|---|
| `isSupport` | 一致 | 存在 | stable，按宿主动态探测 |
| `navigate` | 一致 | 存在 | stable，按宿主动态探测 |
| `saveImageToAlbum` | 一致 | 存在 | stable，按宿主动态探测 |
| `share` | 一致 | 存在 | stable，按宿主动态探测 |
| `getQrCode` | 一致 | 存在 | stable，按宿主动态探测 |
| `sharePicture` | 一致 | 存在 | stable，按宿主动态探测 |
| `closeBrowser` | 一致 | 存在 | stable，按宿主动态探测 |
| `getUserProfile` | 一致 | 存在 | stable，按宿主动态探测 |
| `getAuthorProfile` | 一致 | 存在 | stable，按宿主动态探测 |
| `getAuthorVideos` | 一致 | 存在 | stable，按宿主动态探测 |
| `getAuthorVideoRange` | 在线声明缺失 | 存在 | undocumented，禁止调宿主 |
| `getAuthorRelation` | 一致 | 存在 | stable，按宿主动态探测 |
| `getVideoUserActions` | 一致 | 存在 | stable，按宿主动态探测 |
| `getAnnualReport` | 一致 | 存在 | stable，按宿主动态探测 |
| `getChargeUnlock` | 一致 | 存在 | stable，按宿主动态探测 |
| `openChargePanel` | 一致 | 存在 | stable，按宿主动态探测 |
| `onChargeUnlockChange` | 一致 | 存在 | stable，按宿主动态探测 |
| `getCloudStorage` | 一致 | 存在 | stable，按宿主动态探测 |
| `setCloudStorage` | 一致 | 存在 | stable，按宿主动态探测 |
| `removeCloudStorage` | 一致 | 存在 | stable，按宿主动态探测 |
| `getSharedStorage` | 一致 | 存在 | stable，按宿主动态探测 |
| `setSharedStorage` | 一致 | 存在 | stable，按宿主动态探测 |
| `removeSharedStorage` | 一致 | 存在 | stable，按宿主动态探测 |
| `onContainerChange` | 一致 | 存在 | stable，按宿主动态探测 |
| `getContainerState` | 一致 | 存在 | stable，按宿主动态探测 |
| `setContainerMode` | 一致 | 存在 | stable，按宿主动态探测 |
| `onPlayerChange` | 一致 | 存在 | stable，按宿主动态探测 |
| `getPlayerState` | 一致 | 存在 | stable，按宿主动态探测 |
| `setPlayerState` | 一致 | 存在 | stable，按宿主动态探测 |
| `onPageClose` | 一致 | 存在 | stable，按宿主动态探测 |
| `submitScore` | 一致 | 存在 | stable，按宿主动态探测 |
| `getRankList` | 一致 | 存在 | stable，按宿主动态探测 |
| `getMyRank` | 一致 | 存在 | stable，按宿主动态探测 |
| `checkInputSafety` | 一致 | 存在 | stable，按宿主动态探测 |
| `requestCamera` | 一致 | 存在 | stable，按宿主动态探测 |
| `requestMicrophone` | 一致 | 存在 | stable，按宿主动态探测 |
| `stopMedia` | 一致 | 存在 | stable，按宿主动态探测 |

关联类型 AuthorRangeVideo、AuthorVideoRange、AuthorVideoRangeReq 同时从在线声明消失。历史 TS 签名保留以便迁移；游戏通过 supports 检查，需作者视频列表时按 getAuthorVideos 自身的筛选和分页语义接入。工具内部方法不导出。

## 宿主和审核

以上每一行在 B站 iOS、Android、HarmonyOS、创作中心预览、真实外部浏览器均待人工记录。用 Lab 逐项记录 App 版本、授权状态、探测值、实际返回和降级。浏览器 CI 仅测显式 Mock 及消费端。摄像头/麦克风需手势、业务和系统授权；容器模式仅文档标注的 App 支持，订阅状态确认生效，查询/监听不可用时回退浏览器布局。未核实最低版本，禁止根据 UA 授权。预览充电不可用，正式权益需平台开通；打开面板只确认导航，权益查询异常时保持锁定。保留基础体验。前端结算和权益不得用作发奖或收款凭据。

在线创作中心明确列有用户内容输入和外部服务访问能力，后者涉及域名配置。具体账号审批未登录核验。开发者协议 2.5–2.7 对第三方登录、支付组件、第三方链接和动态规避审核有限制。站内导航按 navigate 类型调用；真实业务先核对游戏获准的能力、内容形态和域名。用户输入在提交时用 allowsInput，拒绝、异常或未取得明确通过时停止展示。该检查不能授予作品 UGC 权限。昵称头像限已获准场景，不进入诊断报告。无内置网络代理、第三方支付或登录。SDK 读取的 toyOpenId 仅用于本地分区。

共享存档用于同一玩家、同一获授权 storageId 的跨 Toy 数据。不同玩家、空间、游戏命名空间独立；共享空间不适合跨玩家消息、实时同步或资产交易。排行榜只保留最高成绩，重复同分也消耗同一 Toy 全部玩家共享的额度。具体 QPS 未公开。`http_error/307044` 明确拒绝。读取可选择带抖动的有限退避，写入不自动重放。具体榜位、周期切换时刻及零分负分的线上表现需实机，SDK 不跨结算 ID 压制较低分。Mock 的周界限不能用作真实平台时钟。

## 业务迁移和恢复

- 普通 refresh 合并并发核验。已知切换账号时调用 refresh({supersede:true})，显式撤销尚在途的旧核验。未知或核验中暂停敏感操作。同一稳定用户可继续使用原实例，确认账号或游客身份变化后重新绑定。
- 写入失败检查 outcome。not_sent 为未调用，rejected 为已识别的明确限流，unknown 为已调宿主但执行结果不明。成功以正常返回表示。存档 sync 保存每次操作 ID，批量预读、写入、读回；同步期间相同选择合并。已知旧请求在途时不能 resolve。刷新后只剩日志时须人工核对并明确接受迟到风险才可 resolve(key, side, {acceptLateWriteRisk:true})。原始宿主 Promise 结束也不能证明跨设备事务完成。
- 无 Web Locks 时持久化写入安全失败。游戏可显式不传 cache 使用内存，需提示用户刷新会丢失待同步数据。原缓存不清空；损坏时通过 CorruptCacheError.exportOriginal() 保存私有备份，用户确认后 resetAfterBackup()，重新创建实例。该备份不属于诊断报告。
- 榜单未知记录不会按 7 天自动清理。只有人工确认并接受以后重新提交的风险，才调用 discardUnknown(id)。在途提交不可处置。服务端没有按结算 ID 的幂等确认。
- 失败的 start 只有在原 Hook 结束且 rollbackStart 完成后才能重试，否则销毁实例。dispose 可能与尚未退出的 Hook 同时执行，游戏资源应协作检查 AbortSignal，销毁必须幂等。媒体停止失败会保留失败结果，避免错误提示成功或重复要求权限。
- supports 缓存 30 秒，支持显式 refresh 和 clearCapabilities；只表示可探测能力。verifyBridge 验证一次公开往返，桥尚未就绪可在宿主恢复后显式重新 initialize。

## 验收索引

| 任务 | 实现位置 | 可重复验证 |
|---|---|---|
| S01、S02 | sdk-session | repair 与 stability 的前台恢复、账号切换、游客作用域和旧响应 |
| S03 | game-storage、sdk-adapter | repair 的迟到写入；game-services 的部分失败；stability 的缓存提交失败 |
| S04 | sdk-adapter、leaderboard | 未知错误、限流、超时后恢复、人工处置 |
| S05 | game-storage、leaderboard | 无锁拒写、内存模式、双实例缓存；WebView 崩溃恢复待实机 |
| S06、S07 | charge、viewport | 事件风暴、迟到响应、查询与订阅、浏览器布局 |
| S08、S09 | game-core、sdk-adapter | 超时、补偿失败、异步重入、并发停止及迟到流 |
| S10、S11 | sdk-runtime、sdk-diagnostics、game-storage 等 | 并发探测、失效刷新、损坏备份、释放和脱敏报告 |
| C01、C05、C06 | sdk-contract、sdk-adapter、本页 | 方法签名比对、授权拒绝、审核响应及故障注入 |
| C02、C03、C04 | game-storage、leaderboard、sdk-mock | 两个槽位两次读一次写；最高分保留、零负分及共享空间隔离 |
| C07 | sdk-test-lab、本页 | 真实设备待测，按 API 和宿主导出报告 |
| C08 | CI、preflight.sh、smoke-sdk-*、examples/vite-consumer | Lab ZIP、独立安装 TGZ、Vite 相对子路径、动态模块及资源、刷新和官方 Doctor |

官方依据：[在线声明](https://www.bilibili.com/toy/publish/sdk)、[创作中心 FAQ](https://www.bilibili.com/toy/publish/guide)、[固定版官方检查清单](https://github.com/bilibili/toy/blob/f418536cc463ad598a775bc1ad6cfb0505905ab7/skills/toy/references/content-checklist.md)。
