# 第一步：模块接入清单

> 本文保留第一步历史快照；当前实现与验收请看 [项目转接文档](project-handoff.md)。

核对日期：2026-10-22（Asia/Shanghai）。本文记录第一步准备结果，不表示统一网页或比赛全流程已完成。

## 版本与交付

| 项目 | 本轮核对结果 | 下一步 |
|---|---|---|
| 正式主线 | 在线 main = `21482925fb703f8629fe537562e56db1b5e47c9d` | 后续仍以 `frontend/index.html` 为正式页 |
| 整合分支 | `codex/unified-desktop-demo` 已快进至同一提交 | 当前没有新业务代码差异 |
| Kaiden / `kadenyeojinhong-droid` | `feat/rescue-ui`，PR #21 已合并；文件 `frontend/rescue.html` | 可以开始把现有模块放入统一工作台 |
| prog / `derecqiu-prog` | `dev-qbc` 最新核对为 `58d62b8022c367e74cdeeac9c777293018ec8f81` | 尚未确认购买模块交付位置及接口 |
| prog 相对 main 的差异 | ahead 2，文件差异仅 `docs/hackathon-demo-scope.md` | 不能将说明文档视为购买流程已交付 |

来源：[main](https://github.com/Nexgen-XMUM/Nexflow/commit/21482925fb703f8629fe537562e56db1b5e47c9d)、[Kaiden PR #21](https://github.com/Nexgen-XMUM/Nexflow/pull/21)、[prog 分支](https://github.com/Nexgen-XMUM/Nexflow/tree/dev-qbc)。
prog 的 PR #23 是此前的主页面与盲盒计算联调。PR #20 作者为 feng-0823，已关闭未合并，不能代替 prog 本轮交付。
所有远端状态都是本次核对时的快照，后续接入前再核对。

## 已有接口与统计口径

下表是当前 main 的实际后端能力；不等于购买负责人已承诺采用的接口。

| 接口 | 用途和关键字段 | 状态说明 |
|---|---|---|
| `GET /api/products` | 清仓商品 `id/name/aliases/on_hand` | 不包含批次安全信息 |
| `POST /api/generate-promo` | 输入 `[{item,qty}]`；返回 `items/totals/carbon/promo/warnings` | 预测，不扣库存、不算已付款收入 |
| `GET /api/blind-boxes/inventory` | `batches`；按 `batch_id` 关联名称和可用数 | 独立 SQLite 库存 |
| `POST /api/blind-boxes/calculate` | `pickup_start/pickup_end/preferences/top` | 只读；`OPTIONS` 或 `NO_OPTIONS` 及 fallback |
| `POST /api/blind-boxes/orders` | `user_id/idempotency_key/pickup_start/pickup_end/mode/preferences` | 当前后端直接模拟付款并预留，返回 `RESERVED`；不能另编真实支付状态 |
| `GET /api/blind-boxes/orders/{order_id}` | 订单状态、取餐窗口、付款标记 | 订单级查询；不是账户余额接口 |
| `POST /api/blind-boxes/pickup` | `{order_id}` | 核销后 `PICKED_UP`，消费库存并结算待发积分 |
| `POST /api/blind-boxes/sweep` | 打烊清算 | 不等于已完成捐赠 |
| `GET /api/blind-boxes/donations` | `donations` 含 `PENDING/DONATED/DISCARDED` | 仅 `DONATED` 算已交接 |
| `POST /api/blind-boxes/donations/handoff` | `{donation_id,recipient}` | 同一接收者重复确认不重复计数；更换接收者冲突 |
| `GET /api/blind-boxes/dashboard` | 经营统计与 `users` 列表 | 可直接用于老板看板；账户专用读取方式仍待负责人确认 |
| `POST /api/blind-boxes/points/redeem` | 用户、请求唯一键、正价金额、抵扣积分 | 现有后端抵扣；不能据此推断购买模块前端已完成 |

看板优先映射：

- `simulated_revenue_sen`：累计模拟付款收入（100 sen = RM1），包含已付款但未取餐的订单。
- `picked_up_qty`：完成取餐的食品件数，不是订单数。
- `donated_qty`：完成交接的食品件数，排除待交接和丢弃。
- `estimated_co2e_kg`：已取餐与已交接食品的足迹估算，不是认证减排或碳信用。
- `conversion_rate/redemption_repurchase_rate` 当前为 null，显示“暂无数据”；接口成功返回 0 时显示 0。
- 清仓草稿的预计售出金额单独展示，不加入模拟付款收入。

## Kaiden 模块接法

当前 `/app/rescue` 已能从 `/app` 链接进入，但它是独立 HTML，主页面草稿、角色和救援页状态互不共享。

现有可复用能力：批次查询、方案与余料展示、演示库存导入、打烊清算、捐赠列表、交接确认、交接后的后端统计刷新。
保留“推荐未联系”和“记录模拟交接”的真实口径。当前 main 版本已移除模拟碳交易和虚构已送达动作；不要根据旧 PR 描述重新加入。

后续统一方式：把救援页的内容、样式和脚本按模块封装进正式工作台，保留后端接口和交接逻辑。两个页面都有全局 `$`、`state`、`api` 和全页 CSS，不能直接拼接两份脚本。正式路由统一由整合负责人维护，迁移后再决定旧 `/app/rescue` 的兼容跳转。
交接成功后刷新看板和批次；待交接不计成果。当前步骤尚未执行这些改动。

## 购买负责人还需提供

1. 负责人确认、可用分支或 PR、提交 SHA、模块文件和启动说明。
2. 模拟购买、订单查询、取餐核销的实际接口；报价确认是否固定原方案，还是后端重新选择。
3. 顾客 `user_id` 的来源，以及积分余额接口的地址、请求、响应与未知用户的表现。
4. 付款、取餐成功后的通知或刷新方式；统一入口需要传入的商品、批次、方案、账户和订单标识。
5. 白天可重复演示的方式与样本；不能要求修改机器时间。

主页面当前还维护 `state.consumer` 的前端示例积分，模拟广播会加分。后续必须移除这套业务余额，改为购买负责人的接口；接口没交付时显示暂无数据，不能从 CO₂e 或广播次数推算余额。

## 演示前必须接上的两处

- 清仓 JSON 商品库存与 SQLite 盲盒批次独立；盘点结果目前不会自动成为可购买批次。全流程接入前需明确按既有样本演示，还是复用负责人提供的登记接口。仅有同名商品不算数据已打通。
- 当前 UTC+08:00 的下单从 21:30 开始；取餐窗口为 21:30–22:00 或 22:00–22:30；22:30 后清算。CLI `backend.blind_boxes.demo` 的固定时钟不等于网页已有白天演示模式。网页演示方式仍需接入阶段解决。

## 允许先推进的第二步

统一角色与导航、对接后端经营看板、封装 Kaiden 已交付模块、复制促销和成果文字、编写启动与演示文档。购买和积分展示等待本轮交付，不另做第二套业务规则。

第一步结论：版本同步和 Kaiden 接口核对已完成；外部依赖只剩购买模块交付和账户合同确认。尚不能宣称整条购买取餐或跨电脑验收完成。
