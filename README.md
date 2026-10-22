# Nexflow · Orbyte Smart Yield
Automate the Routine. Empower the People.

面向马来西亚烘焙店的黑客松项目。店员在打烊时录入剩余商品，后端计算清仓价和 CO₂e 估算，生成 Manglish 促销文案，老板审核后在页面上模拟 WhatsApp 广播。剩余食物还可以组成盲盒出售；组不成盲盒时，给出捐赠孤儿院或生物燃料的方案。

## 当前状态（受控本地演示）

| 功能 | 状态 |
|---|---|
| 商品查询、清仓价计算、BELOW_COST 亏损提示 | 已实现，有自动化测试 |
| 促销文案：本地模板；可选 DeepSeek，失败时回退本地模板 | 已实现，DeepSeek 真实调用记录见 [docs/deepseek-live-validation.md](docs/deepseek-live-validation.md) |
| 盲盒后端：筛选、组合、评分、模拟付款、预约核销、积分、清算捐赠 | 本地 SQLite 演示，见 [backend/blind_boxes/README.md](backend/blind_boxes/README.md) |
| 盲盒计算器 `/api/blind-boxes/calculate`：多方案，或给出孤儿院捐赠 / 生物燃料方案 | 已实现，只读 |
| 老板审批、WhatsApp 广播、送达 / 已读 / 回复 | **页面模拟**，不会真实发送 |

**尚未完成验收、没有上线**：真实 WhatsApp 收发、订单成交扣库存、积分发放、真实捐赠流程、线上部署，以及登录认证和支付。不要对外宣传成已上线功能。

**环保数字都是估算**：CO₂e = 商品重量 × 演示用 CO₂e 系数，生物燃料按固定系数估算。这些数字不是经认证的减排量，也不是碳积分或碳信用。

## 快速启动（Windows）

在项目根目录的 PowerShell 中运行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item backend\.env.example backend\.env   # 默认 local_demo，不调用模型、不需要密钥
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

| 地址 | 内容 |
|---|---|
| http://127.0.0.1:8000/app | 主页面：打烊盘点、老板看板、活动日志 |
| http://127.0.0.1:8000/docs | 接口文档；盲盒接口在 `Blind boxes LOCAL DEMO` 下 |

如果要用 DeepSeek，在 `backend/.env` 里设置 `AI_PROVIDER=deepseek` 和你自己的 `DEEPSEEK_API_KEY`。密钥不要提交到 Git。详细配置见 [backend/README.md](backend/README.md)。

盲盒 API 使用服务器当前时间：21:30 开售，22:30 打烊清算后，剩余食物才会进入捐赠清单。白天演示可以运行固定时钟的模拟程序：`.\.venv\Scripts\python.exe -m backend.blind_boxes.demo`。

## 测试

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
node --test frontend/tests/
```

已知问题：在 Windows 上，如果 Git 开启了 `core.autocrlf=true`，`test_frontend_entry_does_not_expose_repository` 会因为 CRLF 换行而失败，与业务逻辑无关。

## 主要接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/products` | 商品选项（id、名称、别名、库存） |
| GET | `/api/inventory` | 商品原价与库存 |
| POST | `/api/generate-promo` | 提交 `[{"item":"croissant","qty":10}]`，返回价格、CO₂e 估算、文案和警告 |
| POST | `/api/blind-boxes/calculate` | 盲盒方案；没有方案时返回剩余食材统计，以及捐赠或生物燃料方案 |
| — | `/api/blind-boxes/*` | 演示库存、下单、核销、清算、捐赠交接、积分、看板 |

错误统一返回 `{"error": {"code", "message", "details"}}`：输入错误是 422，数据文件不可用是 503，盲盒业务冲突是 409。

## 目录

```text
backend/            FastAPI 后端：main.py（促销）、ai_copy.py（文案）、blind_boxes/（盲盒、计算器）、tests/
frontend/           index.html（主页面），ui system（Ivan 的新版 UI 草稿，尚未接入后端路由），tests/
data/               inventory.json（商品）、charities.json（孤儿院占位名单）、users.json、customers.json
docs/               交接、AI 文案与验收记录
*.json（根目录）     促销、订单、WhatsApp、积分、推荐规则等合成样例，后端目前不读取
```

`data/charities.json` 里是占位示例，不是真实机构；上线前必须换成已核实、同意接收的机构。所有客户和电话都是虚构的演示数据。

## 进行中的 PR

- #20 `codex/feature-new-ui`：新版 UI 接入盲盒报价、付款模拟、捐赠和积分
- #21 `feat/rescue-ui`：`/app/rescue` 打烊去向页面（盲盒、模拟孤儿院捐赠、生物燃料估算、模拟碳排放量交易）

## 团队

| 角色 | 成员 |
|---|---|
| 队长 / 整合 / 前端 | YEO JIN HONG |
| 后端 / 整合 | QIU BO CHUAN |
| 前端 | （待填） |
| 提案 / 演示 | （待填） |

前端和后端的问题统一找队长。
