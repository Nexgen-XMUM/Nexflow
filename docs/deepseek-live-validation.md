# DeepSeek 真实连接与文案验收记录

日期：2026-10-22 · 版本：v1
基线：交接文档 `docs/backend-handoff.md`；此前补齐工作只有模拟验证。
代码基线：`d861f6b6eff1738dde9647465f9cc8ab3d6499bc`，模型实现来自 `7e45d23`。
真实测试使用共享工作区现有接口；当时后端入口唯一未提交差异是 `/app` 页面文件路径，不涉及生成流程。

## 1. 本轮结果

**真实连接成功，两次请求均返回 DeepSeek 文案且没有回退；语言质量仍需人工润色。**

| 编号 | 变化 | 状态 | 对使用者的意义 |
|---|---|---|---|
| C-1 | 从模拟验证推进到官方真实调用 | 已完成 | 单商品与多商品均能连通 |
| C-2 | 事实、长度和业务计算对照 | 已完成 | 两份文案事实正确，模型没有改变业务结果 |
| C-3 | 文案人工验收 | 有保留 | 拼写与售完前催促措辞需要发布者删改 |

用户授权最多 3 次，实际仅 2 次，每次一次外部 POST，不重试；没有故障注入、批量或压力调用。
接口：`https://api.deepseek.com/chat/completions`；模型：`deepseek-flash`，非思考、JSON 输出，整体时限 15 秒。
调用方式：内存中的 FastAPI TestClient 调用现有 `/api/generate-promo`，模型 HTTP 请求为真实外部调用。
临时观测仅保留状态码、最终文案、业务对照和数值型 token 计数；没有启动监听端口的服务。

## 2. 文案、用量与验证证据

### 第 1 次：10 个牛角包

> 🥐 Hai gais, ada clearan bakes! 🥐 10 Butter Croissant: original RM6.00, clearance RM3.00/each. All 10 for RM30.00 (50% off). Jom singgah cepat!

供应商 HTTP 200；应用 HTTP 200；`source=deepseek`、`is_fallback=false`、`fallback_reason=null`。
按空白分词共 23 词，含 Emoji 和马来西亚口语表达。
输入 176 tokens，输出 33 tokens，合计 209 tokens；缓存命中 0，未命中 176。

### 第 2 次：10 个牛角包、2 份蛋糕、1 个酸面包

> 🥐 Hai! Jom tengok bakery clearance kami 🥐 10 Butter Croissant: original RM6.00, clearance RM3.00/each; 2 Chocolate Cake Slice: original RM8.00, clearance RM4.00/each; 1 Sourdough Loaf: original RM14.00, clearance RM7.00/each. All 13 for RM45.00 (50% off). Cepat grab sebelum habis ya 😊

供应商 HTTP 200；应用 HTTP 200；`source=deepseek`、`is_fallback=false`、`fallback_reason=null`。
按空白分词共 42 词，含 Emoji 和马来西亚口语表达。
输入 228 tokens，输出 34 tokens，合计 262 tokens；缓存命中 0，未命中 228。

| 场景 | 数量 | 原价总额 RM | 成本 RM | 清仓总额 RM | 毛利 RM | 亏损 RM | CO₂e 估算 kg |
|---|---|---|---|---|---|---|---|
| 牛角包 | 10 | 60.00 | 20.00 | 30.00 | 10.00 | 0.00 | 2 |
| 三种商品 | 13 | 90.00 | 32.00 | 45.00 | 13.00 | 0.00 | 3.725 |

商品名称、促销数量、原价和清仓单价均逐项匹配返回明细。
两次真实结果的 `items`、`totals`、`carbon`、`warnings` 与相同请求的本地模式基线完全一致。
外部请求的数据白名单验证通过：只含名称、促销数量和清仓单价；成本、亏损、CO₂e 和个人资料不进入模型请求。
合计输入 404、输出 67、总计 471 tokens。响应未提供本次费用，未估算费用，也未查询余额或开启充值。

人工观察：

- 第一条 `clearan` 拼写不规范，建议发布前改为 `clearance`；本记录保留原始返回文案。
- 第二条 `sebelum habis` 表示“售完前”，有库存紧迫的暗示。当前规则放行了该措辞，发布前建议删改。
- 两条都偏马来语与英语混合，含 `Jom`；店铺是否接受这个 Manglish 风格仍由负责人决定。
- 样本没有出现具体虚构赠品、配送、认证减排或碳积分声明；两次样本不能证明所有输出都合格。

常规验证：共享工作区后端测试 214 项通过，1 条既有 Starlette/httpx 弃用提示。
自动测试隔离密钥并禁止真实 HTTP 传输，没有新增付费调用；本次提交仅包含本验收记录。

密钥保护与收尾：

- `backend/.env` 匹配 `.gitignore` 的 `.env` 规则，当前未被 Git 跟踪；已检查的本地历史中也没有该路径提交。
- `.env` 仅在本机保留，权限为当前用户读写；没有放入本记录、测试、日志、命令参数或 PR。
- 两次调用前后 `.env` 文件校验值一致，现有配置未覆盖。这里只记录比较结果，不记录校验值。
- 密钥只用于固定官方地址的 Bearer 鉴权，默认不跟随重定向，出站白名单阻止其他地址。
- 真实模式只在临时进程中启用；进程结束，TestClient 与 HTTP 客户端均关闭，没有遗留临时服务。
- 文件中的 `AI_PROVIDER` 保持测试前配置；真实 Key 保留在本机，常规运行模式未改动。

## 3. 仍未完成

- 文案发布级质量尚未完全验收；本次未更改提示词或声明检查，也没有为润色再消耗一次真实调用。
- 交接记录中的长商品名导致本地模板超过 50 词，以及同义声明漏检，仍是已知边界。
- 超时、无效 Key、限流等继续依赖模拟测试，本次没有用收费调用制造故障。
- 未进行浏览器端到端、多人并发或其他业务功能测试。

复核方式：先阅读上述原始文案与事实表；免费回归使用项目虚拟环境执行 `python -m pytest backend/tests -q`。
后续真实调用需另行明确授权，不因复核文档而再次调用模型。

变更记录：2026-10-22，新增两次获授权的真实调用证据、人工文案观察和密钥保护结果。
