# Nexflow Backend

FastAPI 后端，提供 `GET /api/inventory` 和 `POST /api/generate-promo`。默认使用本地演示文案，可配置 DeepSeek 生成文案开头和结尾；商品、数量、价格和总额由 Python 插入。

## Windows 本地配置与启动

项目已建立 `.venv` 时，在项目根目录的 PowerShell 中运行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

将 `backend/.env.example` 复制为 `backend/.env`，只在本地填写：

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_MODEL=deepseek-flash
CORS_ALLOWED_ORIGINS=
```

不要把真实密钥写进 `.env.example`、源代码、截图或 Git 提交。`.env` 已被忽略。
程序启动时自动读取 `backend/.env`，已有进程环境变量优先；修改配置后重启服务。
`AI_PROVIDER=local_demo` 时不调用模型。DeepSeek 模式会产生供应商 API 用量。
只向官方 `https://api.deepseek.com/chat/completions` 发送商品名称、数量和清仓单价；不发送成本、毛利、客户或电话。
模型默认 `deepseek-flash`，使用非思考模式和 JSON 输出，参考 [DeepSeek 官方文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

连接超时 4 秒，读写等阶段超时 12 秒，不自动重试；这不是整个请求的严格总时限。
密钥缺失、HTTP 错误、网络错误、超时、回复结构错误或文案过长时，促销接口仍返回计算结果和本地模板。
AI 只生成不含金额的开头和结尾，程序检查基本格式、长度和数字等限制；自然语言仍需老板审核，不能保证不存在任何语义错误。

| `promo` 字段 | 含义 |
|---|---|
| `source: "deepseek"`，`is_fallback: false` | 模型调用成功且内容通过检查 |
| `source: "local_demo"`，`is_fallback: false` | 主动选择本地模式，没有调用模型 |
| `source: "local_demo"`，`is_fallback: true` | AI 配置或调用有问题，已回退 |
| `fallback_reason` | 成功或本地模式为 null，失败为不含密钥的类别代码 |

失败类别：`MISSING_API_KEY`、`INVALID_AI_PROVIDER`、`AI_TIMEOUT`、`AI_HTTP_ERROR`、`AI_NETWORK_ERROR`、`INVALID_AI_COPY`。
不会把供应商原始错误响应或密钥返回给前端。
测试通过模拟供应商响应验证，不消耗真实额度；真实连接必须在用户本地填写密钥后另行验证。

## 商品查询

`GET /api/inventory` 从共享库存读取商品，每个商品只返回一次，保持文件中的顺序。

```json
{
  "currency": "MYR",
  "products": [
    {"id": "croissant", "name": "Butter Croissant", "retail_price": "6.00", "on_hand": 18},
    {"id": "chocolate_slice", "name": "Chocolate Cake Slice", "retail_price": "8.00", "on_hand": 8},
    {"id": "sourdough", "name": "Sourdough Loaf", "retail_price": "14.00", "on_hand": 6}
  ]
}
```

前端用 `id` 作为生成促销请求中的 `item`；`retail_price` 为两位小数字符串，`on_hand` 为整数。
库存为零的商品仍返回，前端可禁用其输入。每次请求重新读取库存，不写文件、不扣库存。
库存无效或不可读取时返回 HTTP 503，错误结构与促销接口的 `INVENTORY_UNAVAILABLE` 相同。
查询响应不包含成本价、别名、客户资料或内部文件路径；促销响应仍包含成本，仅用于本地演示。

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

跨域使用 `CORS_ALLOWED_ORIGINS`：精确的浏览器来源，以逗号分隔。默认空，不放行跨域来源。AI 环境变量见上文。
格式是协议、主机和可选端口，不带路径、尾部斜线、查询参数或通配符。
`localhost` 与 `127.0.0.1` 是不同来源，不同端口和协议也分别配置。

`backend/.env.example` 可复制为 `backend/.env` 后填写真实联调地址。
程序启动时自动加载 `backend/.env`，已有进程环境变量优先；下面是 Bash 下手动导入环境变量的可选方式（PowerShell 使用上面的 Windows 命令）：

```bash
set -a
source backend/.env
set +a
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

前端地址尚未提供，当前未配置任何联调来源。
只允许跨域 `GET`、`POST` 和 `Content-Type`，不使用凭据。非法来源配置在启动时失败。
CORS 是浏览器规则，不是认证；直接 HTTP 客户端仍可调用接口。

已实现个人 DeepSeek API 的可选调用及失败回退；比赛云 GPU 的接入尚未实现。

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
    "is_fallback": false,
    "fallback_reason": null
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

`promo.source` 为 `local_demo` 时，前端应标识“本地演示文案”；为 `deepseek` 时，标识 AI 辅助文案。
`is_fallback` 区分主动本地模式和 AI 失败回退，含义见上方表格。
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
商品查询同样只读；不提供审批、广播、活动、客户或用户接口，也不公开静态数据目录。
`users.json` 仅为演示角色数据；没有登录认证或安全 RBAC。
接口包含成本数据，只用于受控的本地演示，不作为公开客户接口部署。

在项目根目录运行：

```bash
.venv/bin/python -m pytest backend/tests -q
.venv/bin/python -m compileall -q backend
```

测试覆盖已知金额、数量类型、别名重复、库存边界、舍入、亏损混合汇总、CO₂e、文案、
数据不变、非公开接口和精确跨域来源。临时库存样本不会改写共享文件。
`test_ai_copy.py` 使用模拟 HTTP 响应覆盖 AI 成功、密钥缺失、超时、网络失败、HTTP 错误和回复校验；测试默认禁用真实 AI 调用。

当前固定的 Starlette TestClient 使用 httpx 会发出一条弃用提示；测试仍能执行。
后续升级测试客户端时再切换其支持的新版客户端，不因此引入本阶段无关的库。

阶段计划见 `docs/phase-1-plan.md`；任务简报见 `docs/tasks/`。
框架用法核对自 [FastAPI 测试文档](https://fastapi.tiangolo.com/tutorial/testing/)、
[FastAPI CORS 文档](https://fastapi.tiangolo.com/tutorial/cors/) 和
[Pydantic 字段文档](https://docs.pydantic.dev/2.12/concepts/fields/)。
