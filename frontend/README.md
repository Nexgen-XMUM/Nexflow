# Nexflow 前后端联调

页面沿用 `index.html` 的原生 HTML/CSS/JavaScript，无需 Node 构建或安装前端依赖。
正式入口 `/app` 已整合根目录 `orbyte smart yield.html` 的新增卡片样式和消费者入口；根目录文件保留为原稿，不直接提供给浏览器。
清仓商品来自后端共享 JSON；盲盒来自独立 SQLite 批次。金额、CO₂e 和初始文案使用后端响应。

## 启动

从仓库根目录运行已有虚拟环境中的后端。下面使用临时盲盒数据库，避免演示和定时清算影响已有本地库存：

```bash
NEXFLOW_DEMO_DIR=$(mktemp -d)
AI_PROVIDER=local_demo DEEPSEEK_API_KEY='' BLIND_BOX_DB_PATH="$NEXFLOW_DEMO_DIR/blind.sqlite3" .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

打开 <http://127.0.0.1:8000/app>。页面与 API 同源，`API = ''`，无需代理或 CORS 配置。
不要双击 HTML 或从仓库根目录启动静态文件服务器。
原来的 `python3 demo.py` 后端调试工具仍保留，在其本机地址后加 `/app` 也能打开本页面。

如必须分开运行静态前端，服务目录只设为 `frontend/`，并修改页面的 `API` 为后端地址；
后端进程设置 `CORS_ALLOWED_ORIGINS` 为精确前端来源，例如 `http://127.0.0.1:5173`。
后端启动时自动加载 `backend/.env`，已有进程环境变量优先。`localhost` 与 `127.0.0.1` 是不同来源。
上述配置只影响当前进程，不修改 `.env`，不调用收费模型。按 Ctrl+C 关闭服务；临时数据库路径保存在该终端的 `NEXFLOW_DEMO_DIR` 中。

## 当前接口

- `GET /api/products`：`{"products":[{"id":"croissant","name":"Butter Croissant","aliases":["croissant","croissants"],"on_hand":18}]}`。
  示例只展示一项，实际返回共享库存的所有商品；不包含成本、售价和客户信息。
- `GET /api/inventory`：已有的售价查询，提供 `currency` 和商品 `id/name/retail_price/on_hand`，没有成本。
  当前录入页无需售价，使用带别名的 `/api/products` 即可；报价统一取生成结果。
- `POST /api/generate-promo`：发送 `[{"item":"croissant","qty":10}]`，不发送角色、价格或零数量项。
  使用 `items`、`totals`、`carbon`、`promo`、`warnings` 渲染。
- HTTP 422／503 的 `error.message` 显示在录入页；网络失败或 30 秒超时后恢复操作；切页时还会显示全局错误提示。
  商品加载失败时点击“重置演示”重新加载。

金额为两位小数字符串，币种 MYR；CO₂e 为十进制字符串、单位 kg CO₂e。
固定半价，可能低于成本；页面显示毛利、亏损合计和警告。
录入列表只显示名称与库存，统一包装图标仅作装饰；不编造中文名、重量或成本。
情景金额按本次数量全部售出计算，不代表已成交营收。
CO₂e 是估算，不是认证减排或碳积分；默认使用本地文案；后端可配置 DeepSeek。页面区分本地模式、AI 文案和失败回退。

## 演示验收

1. 输入 Butter Croissant（牛角包）10 个：原价 RM60.00、成本 RM20.00、清仓金额 RM30.00、毛利 RM10.00、CO₂e 估算 2 kg。
2. 快速输入 `10 croissants, 2 chocolate slices, 1 sourdough`：RM45.00、3.725 kg CO₂e。
3. 输入 19 个牛角包：显示超库存错误；修正为 10 后可以重试。
4. 输入 `1.5`、`-1`：明确报错，不会改成 15 或 1。
5. 切换店员：模拟批准／拒绝按钮禁用；切回老板可编辑文案并模拟广播。
6. 模拟批准不改变情景金额、不扣库存、不实际发送消息；只有本页模拟次数增加。
7. 生成期间不能重复提交或重置；切换到活动日志后，返回结果不会强行跳页。
8. 停掉后端再提交：清掉旧草稿和金额，显示错误，按钮恢复；重新启动后可重试。

角色切换不构成身份认证。审批、广播、送达、已读、回复和日志均为本页模拟，刷新重置。
页面入口只提供指定 HTML，不公开数据目录。生成接口仍包含成本，仅供受控本地演示。

## 盲盒与余料

打开左侧“盲盒与余料”。首次打开读取 `GET /api/blind-boxes/inventory`，显示名称、批次、可用件数、原价和安全截止时间。
空数据库明确显示空库存，不会拿清仓商品填充。在另一个终端明确导入当天合成库存：

```bash
curl -X POST http://127.0.0.1:8000/api/blind-boxes/demo-seed
```

重复导入返回 409，不会重置库存。点击“刷新盲盒库存”，选择规划日期、时段及可选筛选条件，再点击“计算盲盒方案”。
页面先刷新批次名称，再发送 `POST /api/blind-boxes/calculate`，请求示例（日期换成规划日期）：

```json
{
  "pickup_start": "2026-10-22T21:30:00+08:00",
  "pickup_end": "2026-10-22T22:00:00+08:00",
  "preferences": {"avoid_allergens": [], "required_diets": []},
  "top": 3
}
```

- `OPTIONS`：按批次对应商品名称和数量，展示后端的 `retail_sen`、`price_sen`、`packaging_sen` 和 `estimated_co2e_kg`。
  100 sen = RM1；页面只转换展示单位，不重新计算定价。候选互为替代，不表示可同时售出。
- `NO_OPTIONS`：展示后端总原因、逐批次拒绝原因、`fallback` 余料统计和 `choices` 建议。
  机构为演示数据，直线距离、能源及 CO₂e 为估算；没有真实联系机构、交接食品或发送消息。
- 计算不下单、不预留、不扣库存、不加积分。计算器允许营业时间外规划，下单限制没有改变。
  后端每分钟清算；22:30 后可用库存可能转入待捐赠，安全期限也会影响结果。不要修改机器时间绕过限制。

建议检查：

1. 新数据库先计算空库存，确认提示；导入当天演示批次后计算，应出现候选商品和 RM 价格。
2. 在批次仍安全时填 `wheat`：演示面包和蛋糕被排除，剩余饮料无法单独组成含主食的盒子，展示捐赠建议。
3. 规划日期选在批次安全截止之后：展示安全期限拒绝及生物能源估算。这只修改请求日期，不改变系统时间。
4. 停掉服务后计算：旧建议清空、错误可见、按钮恢复；以相同进程配置重启后可重试。

消费者卡片沿用前端独立积分样例，刷新重置，不连接后端积分账户。
前端每 kg CO₂e 估算记 10 演示分、40/30 分换商品，与后端隐藏款核销奖励 10 分、100 分抵 RM1 的规则不同。
两套规则尚未统一，不能据此前端余额执行真实兑换；待决策项见 [本轮汇报](../docs/blind-box-integration/summary.md)。

## 检查

```bash
AI_PROVIDER=local_demo DEEPSEEK_API_KEY='' .venv/bin/python -m pytest backend/tests -q
node --test frontend/tests/*.test.cjs
```

测试无需安装前端依赖；接口映射测试使用仓库 `.venv` 中的 Python TestClient 读取真实响应，并强制本地文案模式。AI 成功与失败回退仅用模拟响应验证，不调用供应商。
盲盒映射测试使用临时数据库，覆盖候选、捐赠、生物能源、空库存、失败恢复、重复请求和积分隔离。

## 团队

| 角色 | 成员 |
|---|---|
| 队长 / 整合 / 前端| （YEO JIN HONG） |
| 前端 | （填名字） |
| 后端 / 整合 / HACKER | （QIU BO CHUAN） |
| 提案 / 演示 | （填名字） |
