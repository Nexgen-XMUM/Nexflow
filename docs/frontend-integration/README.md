# Nexflow 前后端联调说明

整理日期：2026-10-21。对应本地后端提交：`9edb2ee`。
本文描述当前已实现的接口，供前端接入及双方确认。联调说明和示例尚未提交、推送。

## 1. 当前可接入范围

| 功能 | 当前状态 |
|---|---|
| 商品查询、数量校验、促销计算 | 已实现 |
| DeepSeek 文案、本地模式、AI 失败回退 | 已实现；个人配置已完成真实调用验证 |
| 前端网页接真实后端 | 待双方联调 |
| 批准、拒绝、广播、活动日志接口 | 尚未实现 |
| 登录和服务端角色权限 | 尚未实现；页面角色切换不等于权限控制 |
| Runpod 模型调用 | 尚未实现，待明确赞助资源及要求 |

生成促销只返回方案，不保存草稿、不扣库存、不发送 WhatsApp，也不增加真实营收。

## 2. 本机启动与访问地址

在仓库根目录的 PowerShell 运行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

- 调试页面：`http://127.0.0.1:8000/docs`
- API 根地址：`http://127.0.0.1:8000`
- 接口规范：`http://127.0.0.1:8000/openapi.json`

服务器已运行时不用重复启动。8000 被占用时先确认进程，不随意关闭其他服务。
`127.0.0.1` 指当前设备；队友电脑上的网页不能通过其 localhost 访问你的电脑。
第一轮建议在同一台电脑同时运行前端和后端。远程访问方案之后再确认。

### 浏览器跨域配置

先向前端确认其实际地址。例如前端使用 `http://localhost:5173`，后端本地 `backend/.env` 配置：

```dotenv
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

这里只是示例，不能默认队友使用 5173。协议、主机、端口必须完全一致，不能带尾部斜线。
配置后重启后端。Swagger 成功不能证明独立前端页面的跨域调用已通过。
请使用本地 HTTP 开发服务器打开页面，不直接双击 HTML 以 `file://` 联调。

## 3. 查询商品：GET /api/inventory

无请求体。HTTP 200 示例见 [inventory.json](fixtures/inventory.json)。

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

前端从 `products` 生成下拉菜单或商品行。名称用于展示，`id` 用于提交，库存为零时禁用数量输入。
不要在 HTML 里另外维护商品价格和库存。商品查询不包含成本价和客户数据。

## 4. 生成促销：POST /api/generate-promo

请求头：`Content-Type: application/json`。请求体直接是数组，不包在 `items` 对象里。

```json
[
  {"item": "croissant", "qty": 10}
]
```

约定：

- `item` 使用查询接口返回的 `id`。
- `qty` 为正整数，不能是字符串、布尔值或小数。
- 不提交数量为零的行；至少有一行。
- 同一商品只提交一次，不超过 `on_hand`；后端仍会再次校验。
- 不提交前端计算的金额、角色或其他字段，额外字段会被拒绝。

HTTP 200 完整响应见 [promo-success-local.json](fixtures/promo-success-local.json)。
该文件通过本地模板模式生成，用于固定验收，不能当作真实 AI 输出。

### 页面字段映射

| 页面内容 | 后端字段 | 展示建议 |
|---|---|---|
| 商品名称、数量 | `items[].name`、`items[].qty` | 促销明细表 |
| 原价单价 | `items[].unit_retail_price` | RM6.00 |
| 清仓单价 | `items[].unit_clearance_price` | RM3.00 |
| 原价合计 | `totals.retail_total` | RM60.00 |
| 清仓收入 | `totals.clearance_total` | RM30.00，标注方案金额，非已实现营收 |
| 商品成本 | `totals.cost_total` | RM20.00，仅老板界面展示的设计待确认 |
| 毛利 | `totals.gross_profit_total` | RM10.00，不叫净利润 |
| 亏损合计 | `totals.loss_total` | 大于零时醒目提示 |
| CO₂e 估算 | `totals.estimated_co2e_kg` | 2 kg CO₂e，标注估算 |
| 促销文字 | `promo.text` | 放入可编辑文本框 |
| 业务警告 | `warnings[]` | 例如 `BELOW_COST`，成功时也要检查 |

金额是两位小数字符串；CO₂e 也是字符串。优先直接格式化展示，不在前端重新计算价格或利润。
如果以后需要前端汇总，不直接用字符串做加法。数值面板不能用本次方案金额更新成“累计已实现收入”。
碳数据不能叫认证减排量或碳积分；提示可使用 `carbon.note` 的中文解释。
当前生成接口包含成本，没有登录认证，暂用于受控本机演示；隐藏页面字段不等于服务端权限控制。

### 文案来源与回退

| `source` | `is_fallback` | 页面标签 |
|---|---|---|
| `deepseek` | false | AI 辅助文案 |
| `local_demo` | false | 本地演示文案 |
| `local_demo` | true | AI 暂不可用，已使用备用文案 |

`fallback_reason` 成功时为 null；失败时为类别代码：
`MISSING_API_KEY`、`INVALID_AI_PROVIDER`、`AI_TIMEOUT`、`AI_HTTP_ERROR`、`AI_NETWORK_ERROR`、`INVALID_AI_COPY`。
HTTP 200 + `is_fallback: true` 仍是可展示的成功方案，不要整页报错或丢掉金额。
DeepSeek 只生成开头和结尾，商品事实由 Python 插入；文字仍需老板审核。
每次真实生成会产生模型调用费用，不在页面加载或输入变化时自动请求，也不自动循环重试。
浏览器只访问本项目后端，不直接请求模型平台，不接收或保存模型 Key。

## 5. 错误与交互处理

错误示例见 [promo-insufficient-stock.json](fixtures/promo-insufficient-stock.json)，HTTP 422。

| HTTP / 错误码 | 前端处理 |
|---|---|
| 422 `INVALID_REQUEST` | 提示数量和格式需正确 |
| 422 `UNKNOWN_ITEM` | 提示商品无效，可重新查询商品 |
| 422 `DUPLICATE_ITEM` | 提示同一商品只能提交一次 |
| 422 `INSUFFICIENT_STOCK` | 根据 `details[].available_qty` 提示库存不足 |
| 503 `INVENTORY_UNAVAILABLE` | 提示库存暂不可用，保留输入，允许稍后重试 |
| 404 / 405 | 检查接口地址和请求方法 |
| 浏览器网络错误或跨域阻止 | 提示连接失败，检查服务器、地址及 CORS |

用户点击生成后显示 Loading 并禁用生成按钮，完成或失败后恢复。
失败时不能继续显示旧文案为本次新结果；明确区分“上次方案”和“本次失败”，或清空旧方案。
响应以最后一次有效请求为准，不让旧请求覆盖较新的输入。
接口没有保存机制，浏览器取消请求也不能保证云端推理停止或免计费。

### 最小 JavaScript 调用示例

以下只是调用参考，不绑定前端框架，也不修改队友页面。`rows` 是整理好的商品数组。

```javascript
const API_BASE = "http://127.0.0.1:8000";

async function requestApi(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || "请求失败");
    error.code = result.error?.code;
    error.details = result.error?.details || [];
    throw error;
  }
  return result;
}

async function loadProducts() {
  const data = await requestApi("/api/inventory");
  return data.products;
}

async function generatePromo(rows) {
  return requestApi("/api/generate-promo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
}

// 在前端自己的事件处理器中使用 try/catch/finally 管理 Loading 和错误。
// const result = await generatePromo([{ item: "croissant", qty: 10 }]);
// result.promo.text 是文案，result.totals 是金额及碳估算。
// 渲染文案使用 textarea.value 或 textContent，避免将模型文字当 HTML 插入。
```

## 6. 三个联调验收场景

| 场景 | 操作 | 验收标准 |
|---|---|---|
| A 正常生成 | 查询商品后提交 `croissant` × 10 | HTTP 200；原价 60.00、成本 20.00、清仓收入 30.00、毛利 10.00、CO₂e 2；展示文案与正确来源标签 |
| B 库存不足 | 提交 `croissant` × 19（当前库存 18） | HTTP 422；`INSUFFICIENT_STOCK`；显示可用库存 18；不显示为成功生成 |
| C AI 失败回退 | 使用附带的模拟超时响应，或运行下面的模拟测试 | HTTP 200；金额仍正确，`source=local_demo`、`is_fallback=true`、`fallback_reason=AI_TIMEOUT`；页面保留方案并显示备用文案标签 |

C 的固定响应见 [promo-ai-timeout.json](fixtures/promo-ai-timeout.json)，由模拟 AI 超时生成，**不是实际云端超时记录**。
前端可临时在自己的 mock 层加载该响应验收 UI，验收后移除 mock；不要为测试故意删除或泄露密钥。
正常场景也可以先用本地模式，文案稳定且不花额度；真实 DeepSeek 验收只需少量请求，文案不要求每次相同。

后端对应的超时、网络失败测试（不访问模型、不花额度）：

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_ai_copy.py -q -k transport_failure
```

已有验证：124 项后端自动化测试通过；真实 DeepSeek 调用及浏览器接口页面已验证。
尚待验证：队友实际前端页面的字段映射、跨域、Loading、错误提示和回退标签。

## 7. 等队友回复后确认

- 最新前端分支与启动命令是什么？实际浏览器来源地址是什么？
- 当前有哪些输入、按钮、金额面板和文案文本框？哪些仍是假数据？
- 商品统一采用后端查询列表；前端旧 `choc` 应换成 `chocolate_slice`，额外商品需先补共享数据。
- 定价采用目前固定五折并提示亏损，还是改为保本定价？双方确认后再改。
- 移除旧的前端 80% 售出率估算，还是作为独立预测保留？不能混入当前后端结果。
- “批准”“拒绝”“广播”和活动记录目前如何标注为演示？后端状态及扣库存规则待设计。
- Runpod 是额度、指定端点还是自行部署资源？是否有比赛明确使用要求？
- 共同验收上述 A/B/C 后，再讨论审批流程。

## 8. 可复制给队友的消息

> 我这边本地后端已完成商品查询、促销计算、库存校验、DeepSeek 文案和失败回退，并整理了接口说明及三组验收示例。文案读取 `promo.text`，金额读取 `totals`；前端只请求我们的后端，不需要我的模型 Key。你方便提供最新分支、启动方式、前端地址和当前页面输入/展示字段吗？我们先统一商品 ID 和定价规则，再联调正常、库存不足、AI 回退三个场景。审批和模拟广播的服务端接口还没实现，需要一起确认规则。

这段消息尚未发送；文件及后端代码是否上传由仓库负责人另行决定。
