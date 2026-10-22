# 后端 DeepSeek 文案补齐交接

日期：2026-10-21
交接人：Feng
状态：5 项要求中，3 项完成，2 项部分完成；尚未提交或推送，暂不作为全部完成验收。

## 给队友的进度说明

PR #9 原有方案保留：DeepSeek 只生成开头和结尾，Python 计算并插入商品事实。已修复异常响应回退、空白文案校验，增加默认 15 秒整体请求时限；两种文案已补原价，并增加禁止声明检查和模拟测试。

目前完整后端测试为 **214 passed，1 条既有弃用提示**。复查额外发现两个原测试未覆盖的缺口：本地文案在长商品名情况下可能超过 50 词；赠品、配送服务的部分同义表达仍能通过。需要补齐这两处及回归测试后再交付验收。没有调用真实 DeepSeek，真实验证仍等待明确授权。

## 分支及交付位置

- 仓库：Nexgen-XMUM/Nexflow。
- 本地当前分支名称：`origin/dev-feng`。这是本地分支名，不表示改动已上传远端。
- 已在本地 rebase 到当时核实的 `main` / `dev-qbc` 基线：`1bd1358c34b83d542daafa2ab5757b50daa5a659`。
- 所有本轮代码修改仍在本地工作区；未 commit、未 push、未创建 PR。队友仅拉取 GitHub 分支不会获得这些修改。
- 继续操作前重新检查分支和未提交改动，不覆盖其他人的工作，不自行切换共享工作区分支。

## 原始 5 项要求核对

| 要求 | 状态 | 实现与证据 | 剩余问题 |
|---|---|---|---|
| 1. AI 与本地文案写明商品、促销数量、原价、清仓价，保持 Manglish、Emoji，整条不超过 50 词 | 部分完成 | 两种路径复用 `offer_facts()`；当前三种商品的所有非空组合通过事实和长度测试，AI 测试使用完整 15 词开头结尾额度 | 本地模板没有运行时超长处理，长商品名仍可能超限 |
| 2. 异常响应安全回退并保留业务结果 | 已完成 | 校验响应对象、choices、首项、message、content；`choices: [null]` 和多种错误类型均回退 | 未发现该项指定场景的剩余问题 |
| 3. 开头、结尾先去空白再验证非空 | 已完成 | Pydantic 启用 `str_strip_whitespace` 后做最小长度检查；覆盖单边、双边空白及正常首尾空白 | 未发现该项指定场景的剩余问题 |
| 4. 整个模型请求默认 15 秒，到期中止等待并回退，不重试 | 已完成，模拟验证 | `asyncio.timeout` 配合 `httpx.AsyncClient`，保留同步 API 入口；持续空行测试确认取消读取、关闭请求及仅调用一次 | 尚未调用真实供应商，这是按要求保留的验证边界 |
| 5. 限制无依据声明、增加反例、说明人工审阅 | 部分完成 | 拦截指定的 `Delivery included, halal certified!` 及英文、马来文常见配送、优惠、库存、认证、减排和碳积分声明；README 已说明人工审阅 | 仍有常见同义表达漏检，见下方已复现反例 |

## 已复现、尚未修复的两个缺口

### A. 本地文案超长

通过内存替换，把牛角包名称设置为 60 个用空格分隔的 `Bread`，请求 `croissant`、数量 10。没有修改共享库存文件。

实际结果：接口 HTTP 200，本地文案 **77 词**。

原因：`generate_copy()` 只对 AI 拼接结果执行 `len(text.split()) > 50` 检查；主动本地及失败回退模板没有超长处理。当前库存通过测试不等于任意合法商品目录均满足 50 词。

接手任务：先确定超长商品事实的处理策略，再同时覆盖主动本地、模型成功和失败回退。不能通过直接截断而丢失商品、数量或价格。若完整名称和必要事实本身已超过 50 词，如何处理需要与队友确认，不擅自更改 API 或商品名。

### B. 禁止声明仍有同义表达漏检

模拟上游返回以下开头，结尾使用 `Jom makan!`，完成原因 `stop`：

- `Every order comes with a gift lah! 😊`：无依据的赠品条件。
- `Doorstep service included lah! 😊`：暗示包含送货上门服务。

两者实际均返回 `source="deepseek"`、`is_fallback=false`，没有触发回退。

接手任务：将上述反例加入正式测试，补充声明检查，并确保普通招呼仍可通过。自然语言规则不能承诺覆盖全部改写，人工审阅说明继续保留。

**注意：这两个缺口目前只通过额外内存/模拟 HTTP 探针复现，尚未加入正式测试。因此 214 项全绿不能证明它们已解决。**

## 本轮修改文件

| 文件 | 变更 |
|---|---|
| `backend/ai_copy.py` | 可取消的整体时限、响应结构检查、去空白校验、Manglish 常用表达和禁止声明检查 |
| `backend/main.py` | 共用事实拼接，加入原价，折扣展示取自现有代码常量 |
| `backend/tests/test_ai_copy.py` | 模拟上游结构、空白、声明、总时限、取消、数据白名单和亏损场景回归 |
| `backend/tests/test_promo.py` | 更新两种单价的事实断言 |
| `backend/tests/conftest.py` | 隔离 AI 配置、清空密钥，阻止 HTTPX 真实传输 |
| `backend/.env.example` | 增加 `DEEPSEEK_TOTAL_TIMEOUT_SECONDS=15`，无真实密钥 |
| `backend/README.md` | 同步配置、文案示例、限制、启动和 Windows 验证说明 |
| `docs/ai-copy-follow-up.md` | 实施计划及过程验证记录；以本交接文档的复查结论为准 |

原有未跟踪文件 `backend/blind_box_test.py` 和 `docs/frontend-integration/` 未修改，不属于本轮交付。

## 测试证据与复跑步骤

环境：Windows，项目 `.venv`，Python 3.14.7；未安装或升级依赖。

- 修改前基线：138 passed，1 warning。
- 最近复查：**214 passed，1 warning in 2.27s**。
- 编译检查、`git diff --check` 均在上一轮通过；Git 有按现有配置转换 CRLF 的提示。
- 唯一测试警告为既有 Starlette TestClient/httpx 弃用提示。
- 持续空行测试使用 0.05 秒模拟时限，确认取消、关闭及一次调用；另有默认值为 15 秒和配置覆盖测试。
- 临时混合亏损样本：清仓总额 18.00、毛利 1.00、亏损 2.00、CO₂e 估算 1.3。各类回退后 `items`、`totals`、`carbon`、`warnings` 与主动本地基线相同。

在项目根目录 PowerShell 运行：

```powershell
git status --short --branch
.\.venv\Scripts\python.exe -m pytest backend/tests -q -p no:cacheprovider
.\.venv\Scripts\python.exe -m compileall -q backend
git diff --check
```

不需要真实密钥。此前受限执行环境下测试曾无输出；在正常本机权限下取得了上述有效结果。

如需手动验证本地启动，在一个窗口运行：

```powershell
$env:AI_PROVIDER = 'local_demo'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

另开 PowerShell 窗口：

```powershell
$body = '[{"item":"croissant","qty":10}]'
$result = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/generate-promo' -Method Post -ContentType 'application/json' -Body $body
$result.promo
($result.promo.text -split '\s+').Count
$result.totals
```

预期：主动本地 `local_demo/false`，回退原因 null；商品为 10 个 Butter Croissant，原价每件 RM6.00、清仓每件 RM3.00；清仓总额 30.00、亏损 0.00、CO₂e 估算 2。上述启动命令供接手人操作，本轮功能证据来自 TestClient，并非浏览器或独立服务端到端验证。

## 必须保留的边界

- 来源语义：主动本地 `local_demo/false`；AI 成功 `deepseek/false`；AI 失败或不合格 `local_demo/true`，附安全类别原因。
- 新增安全类别 `INVALID_AI_CONFIG`，用于非法总时限配置；默认总时限 15 秒，配置必须为有限正数。
- 模型仍只接收商品名称、促销数量和清仓单价，不发送成本、亏损、电话、联系人名单或角色资料。
- 金额、折扣、数量、盈亏和 CO₂e 继续由 Python 计算；未改业务公式及响应结构。
- 不修改前端；保留已有库存查询，不扩展登录、审批、库存扣减、WhatsApp 发送或云 GPU。
- 所有自动上游测试使用模拟；真实调用必须等用户明确说“开始真实测试”。
- 未进行真实 DeepSeek 验证、浏览器端到端验证和人工文案验收；不将测试通过表述为这些验证已完成。
- 未 commit、push 或创建 PR，后续同样须等待用户明确要求。
- Ponytail/easy-* 不在本机可用工具中；已获用户同意，使用计划文档、直接实施和测试总结替代。

## 建议接手顺序

1. 核对当前分支及未提交改动，取得本地修改内容。
2. 先将两个已复现缺口加入反例测试，再补禁止声明检查。
3. 与队友确认商品事实超长策略后，处理主动本地和失败回退的 50 词保证。
4. 运行完整后端回归和编译检查，更新本交接文档及 README 的验收结论。
5. 保留人工审阅和真实测试授权边界；提交、推送及 PR 另等用户要求。
