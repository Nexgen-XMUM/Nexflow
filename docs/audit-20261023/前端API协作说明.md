# NexFlow｜给前端负责人的协作说明

核对日期：2026-10-23；代码main a3fd0e9。本轮未修改接口。本文件是联调索引与交接提醒，不替代已有API文档；完整字段以启动服务后的 `/openapi.json`、`/docs` 和实际schemas为准。

## 先读这些现有合同

| 内容 | 已有位置 |
|---|---|
| 清仓请求、响应、金额、AI来源、错误 | [backend/README.md](../../backend/README.md)，请求144行、响应158行、错误246行；模型在 [main.py](../../backend/main.py) 第65/93/119/131行 |
| 盲盒API、订单、核销、兑换与状态 | [blind_boxes/README.md](../../backend/blind_boxes/README.md) 第36/83/106/116行；[router.py](../../backend/blind_boxes/router.py)、[schemas.py](../../backend/blind_boxes/schemas.py) |
| 前端购买适配约定 | [purchase-adapter.md](../desktop-integration/purchase-adapter.md)；这是待负责人确认的适配边界，并非已交付模块 |
| 启动与演示 | [quickstart.md](../desktop-integration/quickstart.md)，使用backend.desktop_demo |
| 本轮已复现缺口 | [排查报告](排查报告.md)，不要沿用旧文档的历史测试数字判断当前main |

## 通用调用方式

页面通过同源 `/app` 打开，不双击HTML。沿用主页面已有 `api(path, body)`：不传body执行GET，传对象/数组执行POST，JSON编码，统一30秒前端等待时限。新增脚本不能直接引用任意仓库文件，需要负责人同意后加入main.py资源白名单及页面引用。

| 流程 | 调用与关键格式 | 展示和状态处理 |
|---|---|---|
| 商品目录 | GET /api/products；库存 GET /api/inventory | id用于提交；on_hand是JSON目录库存，不是盲盒available |
| 清仓计算 | POST /api/generate-promo，`[{"item":"croissant","qty":10}]` | qty为正整数，禁止字符串/布尔/小数；零数量不提交。金额为两位小数字符串/MYR；直接显示后端totals，避免自行重新算价 |
| AI来源 | promo.source、is_fallback、fallback_reason | local_demo主动本地与AI失败回退要区分；deepseek不能凭页面选择就宣称调用成功。老板批准后才模拟发布 |
| 批次库存 | GET /api/blind-boxes/inventory | batches[]的available=on_hand-reserved；金额为整数sen，展示RM时除100 |
| 只读规划 | POST /api/blind-boxes/calculate；SuggestRequest加top(1～10) | OPTIONS显示options；NO_OPTIONS显示fallback，不代表库存已预留、已捐赠或能源已产出 |
| 模拟下单 | POST /api/blind-boxes/orders；OrderRequest | 带user_id、idempotency_key、带时区pickup_start/end、mode和preferences；成功状态RESERVED，payment=simulated_paid。返回订单才是实际被选中的内容 |
| 订单恢复 | GET /api/blind-boxes/orders/{order_id} | 用后端状态恢复展示，不在刷新后编造已付款或已取餐 |
| 核销 | POST /api/blind-boxes/pickup，`{"order_id":"后端ID"}` | 成功PICKED_UP后再刷新库存、积分和看板；重复核销不重复加分/扣库 |
| 清算/交接 | POST /api/blind-boxes/sweep；GET /donations；POST /donations/handoff（均带同一前缀） | handoff body为donation_id和recipient。只有DONATED计入已交接；PENDING/DISCARDED不能显示完成。接收方填明确演示名称，本轮空白输入缺口未修复 |
| 经营看板 | GET /api/blind-boxes/dashboard | simulated_revenue_sen是模拟已付款累计；picked_up_qty、donated_qty是食品件数。预测清仓金额另列，不加进收入；null指标显示暂无数据 |
| 积分兑换 | POST /api/blind-boxes/points/redeem；RedeemRequest | 规则见现有README：每积分1sen，最多抵正价30%；仅显示后端确认结果，不自行发放 |

本说明表内的 `/donations` 和 `/donations/handoff` 完整路径分别为 `/api/blind-boxes/donations`、`/api/blind-boxes/donations/handoff`。数据结构与调用例子已有文档，不在这里复制整份响应。

## 购买负责人需要先确认的三个接口问题

1. **所见方案与最终订单：** 当前OrderRequest没有candidate_id/quote_id字段；后端重新抽选前五候选之一，不能承诺用户点击某个计算器方案就买到该方案。沿用现有合同的替代方案是“模拟购买一个盲盒”，付款响应后展示最终内容；若要锁定所选报价，先提出接口变更方案并由负责人确认。
2. **账户读取：** 当前没有专用GET余额接口。dashboard包含users，但不能据此未经同意定义未知账户=0或自建第二套账本。先确认是否由负责人适配dashboard.users，还是另交付账户接口；registerPurchase.getBalance需返回 `{user_id, points}` 并核对账户一致。
3. **积分演示：** 当前只有隐藏款在核销时奖励10积分，普通订单可以是0；后端使用安全随机数，前端不能用固定加分伪造结果。可另展示已有固定种子的CLI模拟来说明规则，不能把它称网页已接通。新演示规则/固定奖励需负责人先批准。

新业务用新幂等键；同一业务的网络重试保留相同body和key。同key不同body会409，不要换key反复抽选。成功后调用既有 `await window.Nexflow.changed('pickup')` 等刷新看板、账户并清理旧建议。购买模块接入后测试：重复点击、响应丢失重试、刷新恢复、切换账户、普通订单0积分和失败恢复。

## 时间与库存

门店时区UTC+08:00；预约只支持当日21:30–22:00、22:00–22:30。真实时间服务21:30开售，过期拒绝下单/核销；比赛使用 `/api/demo/session` 返回的now构造当天时段，不能用电脑时间替代或改机器时间。

演示启动器另提供 POST `/api/demo/leftovers`（同清仓item/qty数组）、POST `/api/demo/close`（空对象）。普通服务没有这些接口。登记必须在打烊前，同一会话一次，同请求重复不入库两次；换数量或混入独立seed库存报409。登记数量沿用盘点，安全/分类信息只是预设合成档案。

calculate允许非营业时间规划，但不等于订单可以跨日/倒置时段；目前基本时段顺序校验还有缺口，前端继续发送正常时段，不自行扩展规则。

## 错误与未知数据

已有规范：`{"error":{"code":"...","message":"...","details":[]}}`。422为结构/输入，409为业务冲突，404为未找到，503为商品目录不可用。使用error.code决定恢复提示，详情只显示必要内容；失败清理旧成功结果，解锁重试，异步旧响应不得覆盖新账户/新请求。

目前机构配置损坏可能返回纯文本500，不符合统一错误封装。前端要为非JSON/网络超时保留通用失败提示，不把失败显示成0或空清单；后端修复需另经负责人确认。

转化率等字段为null显示暂无数据；未知账户和余额失败不能默认0。CO₂e为食物足迹估算，不能写认证减排或碳信用。WhatsApp、付款、机构交接都是模拟；不可将审批/广播当成交，不可将待取餐/待捐赠当完成。

## 协作规则

前端负责界面、交互与调用；后端负责API、算法、业务状态、AI和测试。新任务先读router/schemas/README/tests；准备修改时列文件和原因。若需改合同，先写明旧格式、新格式、原因、受影响界面和不改合同的替代方案，由负责人确认；现有字段/类型不能自行改名、改单位或改业务语义。

这份说明可直接转交前端负责人。本轮未代为发送消息，也未实施上述购买适配或任何接口改动。
