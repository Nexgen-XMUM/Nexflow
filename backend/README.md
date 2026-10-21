# Nexflow Backend

FastAPI 后端，提供 `POST /api/generate-promo`。当前为本地演示文案，无外部模型调用。

## 环境与启动

使用项目根目录的 `.venv`，不要向全局 Python 安装依赖。已使用 Python 3.13 验证。
以下命令均从项目根目录执行；系统默认 `python3` 若为 3.9，请使用 `python3.13`。
根 `requirements.txt` 包含运行和测试所需依赖。

首次建立环境：

```bash
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

之后直接使用现有环境启动：

```bash
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

接口文档：<http://127.0.0.1:8000/docs>；JSON 规范：<http://127.0.0.1:8000/openapi.json>。
库存路径按入口文件定位，从其他工作目录启动时也不依赖当前目录。

## 环境变量与跨域

只有 `CORS_ALLOWED_ORIGINS`：精确的浏览器来源，以逗号分隔。默认空，不放行跨域来源。
格式是协议、主机和可选端口，不带路径、尾部斜线、查询参数或通配符。
`localhost` 与 `127.0.0.1` 是不同来源，不同端口和协议也分别配置。

`backend/.env.example` 可复制为 `backend/.env` 后填写真实联调地址。
程序从进程环境读取变量，不自动加载 `.env`；在项目根目录执行：

```bash
set -a
source backend/.env
set +a
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

前端地址尚未提供，当前未配置任何联调来源。
只允许跨域 `POST` 和 `Content-Type`，不使用凭据。非法来源配置在启动时失败。
CORS 是浏览器规则，不是认证；直接 HTTP 客户端仍可调用接口。

本阶段没有模型密钥或供应商配置。后续先测试个人 DeepSeek API，再连接比赛云 GPU 上的 DeepSeek。
实际接入前核对对应服务的官方文档，再补密钥环境变量与调用失败测试。

## 请求

```bash
curl -sS http://127.0.0.1:8000/api/generate-promo \
  -H 'Content-Type: application/json' \
  -d '[{"item":"croissant","qty":10}]'
```

- 请求体为非空数组；每行只允许 `item` 和 `qty`。
- `item` 接受 `data/inventory.json` 中的 ID 或已声明别名，忽略大小写及首尾空格。
- `qty` 只接受大于零的 JSON 整数；不接受布尔值、字符串及 `1.0`。
- 不接受重复商品，包括不同别名指向同一商品；不自动合并行。
- 数量不得超过 `on_hand`；任一行错误，整次请求失败。

## 成功响应：HTTP 200

```json
{
  "currency": "MYR",
  "discount_rate": "0.50",
  "items": [
    {
      "qty": 10,
      "retail_total": "60.00",
      "cost_total": "20.00",
      "clearance_total": "30.00",
      "gross_profit_total": "10.00",
      "loss_total": "0.00",
      "estimated_co2e_kg": "2",
      "item": "croissant",
      "name": "Butter Croissant",
      "unit_retail_price": "6.00",
      "unit_cost_price": "2.00",
      "unit_clearance_price": "3.00"
    }
  ],
  "totals": {
    "qty": 10,
    "retail_total": "60.00",
    "cost_total": "20.00",
    "clearance_total": "30.00",
    "gross_profit_total": "10.00",
    "loss_total": "0.00",
    "estimated_co2e_kg": "2"
  },
  "carbon": {
    "is_estimate": true,
    "note": "Based on product weight and the supplied CO2e factor; not certified emissions reductions or carbon credits."
  },
  "promo": {
    "text": "🥐 Eh, bakery deals lah! 10 Butter Croissant at RM3.00 each. All 10 for RM30.00 (50% off). 😊",
    "source": "local_demo",
    "is_fallback": false
  },
  "warnings": []
}
```

### 金额与亏损

所有金额都由 Decimal 计算，JSON 金额统一为两位小数字符串，币种 MYR（展示为 RM）。
`discount_rate` 是减免比例，当前固定为 0.50。
五折单价按 `ROUND_HALF_UP` 舍入到分后，再乘数量。
例如原价 RM6.01、数量 3：五折单价 RM3.01，清仓总价 RM9.03。

| 字段 | 含义 |
|---|---|
| `retail_total` | 原价 × 数量 |
| `cost_total` | 成本单价 × 数量 |
| `clearance_total` | 舍入后的五折单价 × 数量 |
| `gross_profit_total` | 清仓总价 − 成本总额，允许负数；不含其他运营费用 |
| `loss_total` | 每行取毛利负数的绝对值，否则为零 |
| `totals.gross_profit_total` | 所有商品毛利的合计 |
| `totals.loss_total` | 亏损行的亏损合计，不被盈利行抵消 |

清仓单价低于成本仍返回 200，不自动提价、不拒绝生成。
例如牛角包成本临时改为 RM4.00，数量 2：清仓金额 RM6.00、成本 RM8.00、毛利 -RM2.00、亏损 RM2.00。
此时对应行及汇总返回 `loss_total: "2.00"`，并返回一条提示：

```json
{
  "code": "BELOW_COST",
  "message": "croissant: clearance price is below cost; loss is MYR 2.00."
}
```

以上亏损例子使用临时测试样本；共享商品数据未修改。
亏损只记录在本次 JSON 响应中，不写活动日志或数据库。

### CO₂e 与文案

`estimated_co2e_kg` 为十进制字符串，计算公式为 `qty × weight_kg × co2e_per_kg`。
按现有系数估算：牛角包 10 个是 2 kg CO₂e；再加蛋糕 2 份和酸面包 1 个，合计 3.725 kg CO₂e。
商品重量不是面粉重量。该估算不是经认证的减排量，也不等于碳积分。

`promo.source` 当前固定为 `local_demo`，前端应据此标识“本地演示文案”。
`is_fallback` 为 false，表示主动使用演示模式，没有尝试真实模型。
本地模板只使用代码返回的名称、数量、清仓单价和清仓总价，不包含成本、亏损或客户资料。
对当前三个商品的所有非空组合，文案包含 Emoji 和 Manglish，按空白分词不超过 50 词。
未来商品目录扩大或名称变长时，再调整本地模板的长度策略。

## 错误响应

请求与业务校验统一返回 HTTP 422。错误结构为 `error.code`、`error.message` 和 `error.details`。
索引从 0 开始；类型错误用 `location` 标明位置，不回显原始输入。

超过库存：

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Requested quantity exceeds available stock.",
    "details": [{"index": 0, "item": "croissant", "available_qty": 18}]
  }
}
```

数量为字符串时：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Request must be a non-empty array of items with positive integer quantities.",
    "details": [{"location": ["body", 0, "qty"], "code": "int_type"}]
  }
}
```

| HTTP | 错误码 | 含义 |
|---|---|---|
| 422 | `INVALID_REQUEST` | JSON、结构、数量类型或额外字段错误 |
| 422 | `UNKNOWN_ITEM` | 商品 ID 或别名不存在 |
| 422 | `DUPLICATE_ITEM` | 同一商品重复出现 |
| 422 | `INSUFFICIENT_STOCK` | 请求数量大于库存 |
| 503 | `INVENTORY_UNAVAILABLE` | 库存文件缺失、损坏或必要数据无效 |
| 404 / 405 | `HTTP_ERROR` | 路由不存在或方法不支持 |

库存错误不返回内部路径或原始异常。库存中的价格需为非负、最多两位小数的有限值；
库存量需为非负整数，商品重量为正数，CO₂e 系数为非负有限值，商品 ID 和别名不可跨商品冲突。
CORS 预检错误由标准中间件返回 HTTP 400，不使用上述业务错误结构。

## 边界与测试

生成操作不扣库存、不写文件、不发消息；同一请求可以重复执行。
不提供审批、广播、活动、客户或用户接口，也不公开静态数据目录。
`users.json` 仅为演示角色数据；没有登录认证或安全 RBAC。
接口包含成本数据，只用于受控的本地演示，不作为公开客户接口部署。

在项目根目录运行：

```bash
.venv/bin/python -m pytest backend/tests -q
.venv/bin/python -m compileall -q backend
```

测试覆盖已知金额、数量类型、别名重复、库存边界、舍入、亏损混合汇总、CO₂e、文案、
数据不变、非公开接口和精确跨域来源。临时库存样本不会改写共享文件。
模型调用及失败测试随真实 DeepSeek 接入一起进行，本阶段未声称完成。

当前固定的 Starlette TestClient 使用 httpx 会发出一条弃用提示；测试仍能执行。
后续升级测试客户端时再切换其支持的新版客户端，不因此引入本阶段无关的库。

阶段计划见 `docs/phase-1-plan.md`；任务简报见 `docs/tasks/`。
框架用法核对自 [FastAPI 测试文档](https://fastapi.tiangolo.com/tutorial/testing/)、
[FastAPI CORS 文档](https://fastapi.tiangolo.com/tutorial/cors/) 和
[Pydantic 字段文档](https://docs.pydantic.dev/2.12/concepts/fields/)。
