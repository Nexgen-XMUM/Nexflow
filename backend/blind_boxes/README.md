# Smart Rescue Box 本地 MVP

本模块实现已确认的两个阶段：筛选、组合、评分、随机、成本加成，以及 SQLite 预留、模拟付款、预约核销、积分、爽约冻结和捐赠清算。独立于旧促销 JSON 库存，所有身份和付款均为本地演示；没有真实支付、短信、配送、认证或多门店服务。

## 快速运行

在项目根目录 PowerShell 执行任意时间可运行的完整模拟：

```powershell
.\.venv\Scripts\python.exe -m backend.blind_boxes.demo
```

模拟时钟固定为 2026-10-22 21:30 UTC+08:00，使用临时数据库、合成食品和固定随机种子。演示一笔领取和一笔未领转捐赠，结束自动清理数据库，不改变本地业务数据。该种子只用于演示，API 的抽选使用 SystemRandom，不接受客户端种子。

启动真实本机 API：

```powershell
$env:AI_PROVIDER = 'local_demo'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000/docs 中的 `Blind boxes LOCAL DEMO`。API 使用服务器当前时间，非营业时间拒绝下单；不要为绕过营业规则修改真实机器时钟，白天用上面的模拟程序。旧 `/app` 页面尚无盲盒 UI。

SQLite 默认位置 `data/local/blind-boxes.sqlite3`，首次数据库操作才创建，已被 Git 忽略；可用 `BLIND_BOX_DB_PATH` 指定其他路径。无需新依赖，使用 Python 标准库 sqlite3。库存不从旧 inventory.json 自动导入，不凭商品名称推断安全、主食或饮食资格。

## API 合同

统一前缀 `/api/blind-boxes`，API 的金额字段采用整数 sen，100 sen = RM1，不能直接照搬旧促销两位字符串的渲染代码。时间必须带时区，门店使用 UTC+08:00。

| 方法和后缀 | 作用 |
|---|---|
| POST /demo-seed | 明确导入当天 3 种合成库存；重复导入报 409，不重置库存 |
| POST /batches | 管理员演示入口，新增批次数组；不覆盖已有批次 |
| POST /batches/{batch_id}/block | 停售批次；已有订单核销时仍重新检查安全 |
| GET /inventory | 查询盲盒批次及可用数量 |
| POST /suggest | 只读候选方案与评分、拒绝原因和搜索截断标记 |
| POST /orders | 模拟付款、选定内容和隐藏款、原子预留库存 |
| GET /orders/{order_id} | 读取订单及状态 |
| POST /pickup | 预约窗口内核销、扣库存、积分到账 |
| POST /sweep | 立即进行可重复的爽约与余料清算 |
| GET /donations | 捐赠清单和状态 |
| POST /donations/handoff | 人工确认交接，重新检查安全、扣库存 |
| POST /points/redeem | 模拟正价购买抵扣，不调用支付系统 |
| GET /dashboard | 收入、领取与捐赠统计、积分余额和冻结状态 |

下单示例（日期换成今天，调用时间必须在开售后且时段结束前）：

```json
{
  "user_id": "demo_alice",
  "idempotency_key": "order-alice-0001",
  "pickup_start": "2026-10-22T21:30:00+08:00",
  "pickup_end": "2026-10-22T22:00:00+08:00",
  "mode": "standard",
  "preferences": {
    "avoid_allergens": [],
    "required_diets": ["vegetarian"],
    "likes": ["bread"],
    "dislikes": []
  }
}
```

`/suggest` 使用同一对象但去掉 user_id、idempotency_key。新业务使用新 key，网络重试复用原 key 和原请求；同 key 不同内容报 409。不得用新 key 重试来反复重抽，已下单内容和隐藏款固定，且计入日限购。

核销请求为 `{"order_id":"返回的订单ID"}`。捐赠交接为 `{"donation_id":"清单中的ID","recipient":"演示接收机构"}`。积分抵扣为 `{"user_id":"demo_alice","idempotency_key":"redeem-alice-0001","regular_price_sen":1000,"points":10}`。

返回的订单包括 lines 批次及数量、价格/成本/包装费、评分细项、隐藏款概率及结果、待到账和已到账积分。这里是内部本地演示 API，会显示成本和内容，不是匿名顾客盲盒展示接口。

输入结构错误返回 422；业务状态冲突返回 409；未知订单/批次/捐赠单返回 404。错误保持 `error.code/message/details` 结构。具体字段定义以 `/docs` 和 schemas.py 为准。

## 算法与政策

- 安全和储存人工确认、已知过敏原和饮食资料、可售时间覆盖预约结束、剩余库存是硬条件。allergens 包含需要避开的已知交叉接触风险；null 表示未知，空数组代表提供者明确声明无已知项。系统无法验证申报真实性。
- 至少 1 件主食，每盒 2～4 件，同 product_id 跨批次最多 2 件。最多保留 300 个候选、访问 20000 个搜索节点；截断时不声称全局最优。优先搜索安全截止较早的批次，按批次数量组合去重。
- 售价 = 成本 × 1.30，四舍五入到 sen 后 + 50 sen 包装费。售价大于原价合计 70% 的候选被排除。
- U 为 `100 × clamp(1−剩余安全小时/4,0,1)`；I 为商品合格可用库存相对最大商品库存；D 为不同品类数/2，最高 100；F 为喜欢100、普通50、不喜欢0。U/I/F 按件平均；总分权重 35/25/25/15。禁忌不会变成软偏好。
- 前 5 个候选 softmax 抽选，权重 `exp((S-Smax)/T)`，普通 T=5，惊喜 T=10；按最终方案不再使用旧稿的额外 15 分差门槛。
- 隐藏概率 = `min(0.20, 0.05 + 0.20×毛利率 + 0.10×合格饮料库存占比)`。毛利扣除商品和包装成本。隐藏款只奖励 10 积分、不赠饮料；核销到账。
- 100 积分抵 RM1，即每积分 1 sen；抵扣不超过模拟正价消费 30%，余额不得为负。
- 日限购按门店日期每个模拟 user_id 最多 2 盒。19:00～21:00 以及21:00～21:30均不可下单，21:30 开售；只支持当日两段预约，无独立客流容量限制，以库存为限。
- 滚动 30 天两次爽约冻结 7 天，冻结结束后的爽约重新累计；统计取餐结束时刻，避免把延迟执行清算当成新的爽约日期。

这些数值是已确认的 MVP 演示政策。价格和搜索常量在 algorithm.py，限购/冻结/积分规则在 repository.py，预约时段在 pickup.py；暂无在线政策编辑器。

## 状态和事务

订单 `RESERVED → PICKED_UP` 或 `NO_SHOW`。捐赠单 `PENDING → DONATED` 或 `DISCARDED`。下单增加 reserved；核销、交接或报废同时扣 on_hand 和 reserved。NO_SHOW 转捐赠时保持预留，不能再次出售。混合盒任一食品不安全时整盒报废，保守处理，不拆盒二次售卖。

每个状态转换使用 BEGIN IMMEDIATE 事务，库存条件更新、订单和积分一起提交或回滚。请求幂等键持久化；核销、清算和交接可重复调用而不重复计账。正常订单不提供取消或退款；异常退款需后续定义并实现，不将本地模拟当成真实退款政策服务。

服务运行时每 60 秒自动清算；下单前也清算，另有手动端点。关店后剩余库存进入待捐赠；过期、停售或存储未核验食品转报废。服务关闭期间不会执行，重启后下一次任务补处理。停止服务后等待中的任务被取消；多个进程重复清算由 SQLite 事务和状态保护。

捐赠交接只确认当前仍安全，不代表第三方运输已经完成或之后一直安全；领取后的储存/食用时限必须由真实门店另行提供。本模块不连接机构或配送团队。

## BI 与边界

simulated_revenue_sen 统计所有模拟已付款订单，包括不可退款的未领订单。picked_up_contribution_sen 是已领取售价减包装费，忽略已发生商品成本；picked_up_gross_profit_sen 还扣商品成本，两者都不是净利润。积分抵扣的正价订单金额不混入盲盒收入。

救援数量、重量和碳足迹估算只统计已核销或已交接食品，未领、待捐赠、报废都不计入。没有访问和正价订单归因数据，两个转化率返回 null。不存在真实账号、手机号或设备校验，换模拟 user_id 可绕过限购，这是演示身份边界。

安全数据录入、库存隔离和碳因子均为演示；demo-seed 中饮料等统一系数不是查证后的食品因子。后续需要真实门店确认。旧 DeepSeek 模块保持原状，新盲盒算法不调用模型、不消耗额度。

## 自测

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
node --test frontend/tests/input.test.cjs
.\.venv\Scripts\python.exe -m compileall -q backend
```

test_blind_boxes.py 覆盖手算价格和评分、安全拒绝、跨批次上限、搜索边界、随机范围、数据库持久化、并发最后库存、幂等、回滚、时间边界、积分、冻结解除、捐赠及后台清算。测试数据库均在临时目录。
