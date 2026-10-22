# Feature New UI：总结与交接

更新日期：2026-10-22。交付状态：本地新UI已整合到主线快照026567d；整合后后端265项、前端34项通过，同应用临时数据库HTTP联调通过。尚未提交、推送或创建新PR；整合后的版本尚未由用户再次手动验收。

## 给队友的简短说明（可复制）

已在本地 `codex/feature-new-ui` 把盲盒模块接入 Pan 的老板/顾客页面，跑通固定报价、隐藏商品内容、模拟付款、核销、独立积分、捐赠交接和统计。Pan 原 HTML 只增加独立 JS/CSS 引用，原促销和环保积分脚本保留。报价确认不重抽盒；库存或安全条件变化会拒绝确认。已同步main的026567d并保留PR #19计算器、机构配置及测试，整合后后端265项、前端34项通过。用户此前已完成主流程和积分抵扣手动验收，本轮整合后又完成同应用HTTP联调。修改仍未提交或推送，待审阅最终差异后再决定提交。

## 当前代码与 GitHub 的关系

| 项目 | 已核实状态 |
|---|---|
| 本地分支 | `codex/feature-new-ui` |
| 独立工作区 | `C:\Users\Zhengxi Chen\.codex\worktrees\feature-new-ui\Nexgen backend` |
| 最初开发基线 | `da3c1d6da2fd82e190aa889e65dfb8b1d68f3205`，Pan PR #18 的合并提交 |
| 当前HEAD / 整合基线 | `026567ddb6f0ed9e882387bb1f4e46c5bc5cc927`，与本次获取的origin/main一致 |
| 原始盲盒来源 | `codex/blind-box-backend-mvp` 的 `a8563791c7a1e0b68aac24fb5d8ebe55ae39fac2` |
| 原 PR #12 | 本次通过 GitHub API 核实为 closed、merged=false |
| 最新 main 核对快照 | `026567ddb6f0ed9e882387bb1f4e46c5bc5cc927`，已合并 PR #19 |
| PR #19 内容 | 已包含原 PR #12 的盲盒代码，并新增 `/calculate`、`calculator.py`、计算器测试和 `data/charities.json` |

GitHub 状态是上述时间点的只读核对结果，之后可能变化。本次已获取origin/main，将本地功能分支基线移到已存在的026567d，并保留未提交的新UI改动，没有创建新提交或合并提交。CalculateRequest、Repository.calculate及/calculate均保留；calculator.py、原计算器测试和charities.json与主线一致。UI没有新增calculate专用可视化操作，该API在整合后应用中正常可用。

来源：[PR #12](https://github.com/Nexgen-XMUM/Nexflow/pull/12)、[Pan PR #18](https://github.com/Nexgen-XMUM/Nexflow/pull/18)、[已合并 PR #19](https://github.com/Nexgen-XMUM/Nexflow/pull/19)、[主线快照](https://github.com/Nexgen-XMUM/Nexflow/tree/026567ddb6f0ed9e882387bb1f4e46c5bc5cc927)。

## 已完成的页面流程

| 角色 / 功能 | 行为 |
|---|---|
| 顾客报价 | 填写日期、时段、模式、偏好和过敏原；获取固定盒子及价格，展示2～4件范围、必要过敏原和时段，隐藏商品、批次、成本及评分 |
| 模拟下单 | 只提交报价ID、模拟用户和幂等键；服务器复查原批次安全、资料、库存、限购及冻结，不重抽、不静默改价；报价不占库存，确认成功才预留 |
| 订单同步 | 顾客读取自己的演示订单和已到账积分；老板按订单ID查看完整组合并在预约时段核销 |
| 积分 | 隐藏款奖励10分，仅核销后到账；与 Pan 原促销环保积分分开 |
| 积分抵扣 | 100分抵RM1，最多抵扣正价消费30%；整数sen计算；成功后显示后端回执并刷新余额；下一笔消费需显式开始 |
| 捐赠管理 | 老板查看待交接/已交接/报废；按服务器时间清算；填写接收方后确认模拟交接，安全不合格的食品不能交接 |
| 统计看板 | 模拟付款金额、已领取毛利/金额贡献、已领取和已交接件数与重量、食品CO₂e估算；缺少归因数据的比率显示“暂无数据” |
| 网络失败 | 报价、确认、交接和抵扣保留原请求用于重试；相关确认参数固定，避免不确定结果下另起请求 |

新页面入口 `/app/new-ui`。旧 `/app` 继续返回 `frontend/index.html`。新 CSS/JS 通过两个指定路径提供，不公开整个仓库目录。

## 本轮新增 API

以下均在 `/api/blind-boxes` 下：

| 接口 | 请求 / 作用 |
|---|---|
| `POST /quotes` | 原 OrderRequest：`user_id`、`idempotency_key`、带时区的 `pickup_start/end`、`mode`、`preferences`；服务器保存组合、价格、披露快照和隐藏结果，只返回顾客展示白名单 |
| `POST /quotes/confirm` | `quote_id`、`user_id`、新的 `idempotency_key`；同一报价只产生一笔订单，重试原确认键返回同一订单 |
| `GET /customer/account?user_id=...` | 仅返回指定演示用户的积分、冻结时间及订单白名单，不含商品明细和成本 |

沿用原 `/inventory`、`/orders/{id}`、`/pickup`、`/sweep`、`/donations`、`/donations/handoff`、`/dashboard`、`/points/redeem`。现已同时保留PR #19的/calculate。router.py和repository.py的重叠已手动合并，CalculateRequest与QuoteConfirmRequest并存，没有用旧模块整目录覆盖主线。

## 启动：这台电脑

下面每一条命令分别执行；不要输入 Markdown 的三个反引号。`&` 在路径引号外。

```powershell
$env:AI_PROVIDER = 'local_demo'
```

```powershell
& 'C:\Users\Zhengxi Chen\Documents\ChatGPT\Nexgen backend\.venv\Scripts\python.exe' -X utf8 -m uvicorn backend.main:app --app-dir 'C:\Users\Zhengxi Chen\.codex\worktrees\feature-new-ui\Nexgen backend' --host 127.0.0.1 --port 8000
```

保持 PowerShell 窗口打开，访问 [本地新 UI](http://127.0.0.1:8000/app/new-ui)。`--app-dir` 允许从其他目录启动，避免 `No module named backend`。

本机复用了原仓库虚拟环境；独立工作区没有自己的 `.venv`。此次没有安装或升级依赖。已验证 Python 3.14.7；依赖版本以根目录 `requirements.txt` 为准。前端无需构建或安装 npm 包，Node 仅用于自动化测试。队友机器需在其仓库创建/使用自己的 Python 虚拟环境。

正常服务使用实际服务器时间，21:30开售。切换角色不改变营业规则，不能修改电脑时间来绕过校验。默认盲盒数据库为 `data/local/blind-boxes.sqlite3`，与旧促销JSON库存分离；可通过 `BLIND_BOX_DB_PATH` 指定演示库。

## 测试及人工验收

最后代码阶段已运行：整合后后端 **265 passed，1条既有Starlette/httpx弃用提示**；前端 **34 passed**；git diff --check通过。相比整合前259项，新增主线原有的6项计算器测试，全部通过。另在新进程、同一个应用和独立临时数据库中进行HTTP联调，覆盖calculate只读库存、隐藏报价、固定金额及幂等确认、核销及顾客视图、积分成功/余额不足分支、清算与幂等交接、实际统计及旧促销RM30.00。没有连接真实AI、支付或配送。

复跑时先进入独立工作区：

```powershell
Set-Location 'C:\Users\Zhengxi Chen\.codex\worktrees\feature-new-ui\Nexgen backend'
& 'C:\Users\Zhengxi Chen\Documents\ChatGPT\Nexgen backend\.venv\Scripts\python.exe' -X utf8 -m pytest backend/tests -q -p no:cacheprovider
```

```powershell
$env:NEXFLOW_TEST_PYTHON = 'C:\Users\Zhengxi Chen\Documents\ChatGPT\Nexgen backend\.venv\Scripts\python.exe'
node --test frontend/tests/input.test.cjs frontend/tests/flow.test.cjs frontend/tests/blind-boxes.test.cjs
```

| 用户已手动确认 | 结果 |
|---|---|
| 普通服务开售前操作 | 明确提示21:30开售 |
| 报价→模拟付款→老板查询→核销→顾客同步 | RM10.90金额保持一致；订单变为已领取 |
| 避免过敏原wheat | 当前演示库存无合格组合，拒绝推荐 |
| 捐赠清单→模拟交接→刷新 | 状态及接收方保存一致，已交接记录不再提供交接按钮 |
| 统计看板 | 页面显示正常，缺失比率为暂无数据 |
| 积分抵扣 | 正价RM1.00、使用10分，抵扣RM0.10、模拟应付RM0.90，余额10分降为0分 |

代理另外验证了报价金额稳定、超限抵扣、空接收方拦截、安全报废状态及浏览器页面；检查时控制台无error。响应丢失/重试、并发最后库存等主要由自动化测试覆盖，不能描述为用户全部手测过。手机布局、真实身份认证、真实支付/配送及公开部署未验收。

## 临时测试页与素材

本轮人工验收使用三个独立临时服务，数据库互不影响：8001为21:30下单场景，8002为22:30捐赠场景，8003为隐藏款领取后积分场景。固定测试时钟只存在于本地测试启动脚本；产品API仍使用实际时间。8003通过确定性测试夹具产生两笔已领取隐藏款订单，不能据此宣称真实随机概率已验收。

测试脚本位于原工作区 `data/local/new_ui_guided_test.py`、`new_ui_donation_test.py`、`new_ui_points_test.py`，均为忽略的本机辅助文件，**不在本分支交付清单或PR范围中**。数据库随相应测试进程结束清理，不属于持久化业务数据。本次整合没有停止或重启用户正在使用的测试服务。这些旧进程已经导入整合前的Python代码，不能用它们证明新calculate已经加载。重新启动服务才会加载整合后完整API；本轮自动化及HTTP联调使用新进程中的最新源码。

截图保存在本机，未加入仓库：

- `C:\Users\Zhengxi Chen\.codex\visualizations\2026\10\22\01a16307-661d-79f2-94ea-049249033d46\new-ui-quote.png`
- 同目录 `new-ui-donations.png`、`new-ui-dashboard.png`、`new-ui-points.png`。

## 本次整合与备份

- 获取并整合的主线快照：026567ddb6f0ed9e882387bb1f4e46c5bc5cc927。
- 主线14个文件变动中，router.py有两处、repository.py有一处重叠；保留两边接口和import后，候选Python源码通过语法检查。
- 整合前23个修改/未跟踪文件、原Git索引、已跟踪文件补丁和逐文件合并计划均备份在：`C:/Users/Zhengxi Chen/Documents/ChatGPT/Nexgen backend/data/local/new-ui-sync/20261022-191450`。
- 只将本地分支移到远端已有后续提交，未创建提交，修改仍未暂存。原共享工作区保持codex/blind-box-backend-mvp及原有两个未跟踪文件。
- 无内容改动的继承文件恢复Git标准换行，避免把CRLF当作业务差异。相对新基线的实际交付范围为17个文件，见[改动清单](new-ui-changes.md)。

## 后续审阅与提交

1. 用户审阅17个文件的最终差异和[PR文案草稿](new-ui-pr-draft.md)。真实认证、支付、机构联络及calculate专用UI不属于本轮完成范围。
2. 若需要对整合后版本再做页面人工验收，使用新启动服务；旧8001～8003进程未重启，不能证明新后端。
3. 提交前再核对届时最新main；若主线又前进，按实际变化整合、复测，不能机械沿用265项结果。
4. 只提交清单内源码、文档和测试，排除.env、数据库、虚拟环境、备份及本机固定时钟启动脚本。
5. 只有用户明确授权后才commit、push、创建PR或合并；本次仅本地整合、测试和说明更新。

## 已知产品边界

这是受控本地演示：没有真实登录/角色权限，输入模拟user_id并非身份验证；现有管理API仍可返回内部明细，顾客白名单不是访问控制。没有真实支付、WhatsApp发送、机构联络、运输或配送。报价不占库存，确认前可能售罄。SQLite已有文件持久化与幂等保护，但多人生产部署、真实支付和认证未实现。CO₂e及食品安全资料为演示资料，不是认证减排量或外部核验。最新主线calculate使用的机构文件也被其作者标为占位示例，本轮未核验机构或生物燃料系数。
