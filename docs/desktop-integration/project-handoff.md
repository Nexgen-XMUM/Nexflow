# 项目转接文档：统一电脑版、经营看板与比赛演示

日期：2026-10-22。当前交付为独立整合分支，准备通过团队 PR 审查；购买负责人模块尚未交付，本轮按用户要求先跳过该依赖。

## 接手先读

正式入口是 `/app`，仍以最新已核对 main 的 frontend/index.html 为基础。已经把 Kaiden 的救援功能放入同一个工作台，经营看板读取现有后端，促销与成果文字可复制。保留清仓、DeepSeek来源标识、错误恢复、盲盒计算。

当前可演示：盘点 → 促销审核/复制/模拟广播 → 显式登记同一份余货为合成演示批次 → 方案/余料建议 → 模拟捐赠交接 → 后端经营看板。购买、取餐网页和积分账户接口明确待接入；不宣称端到端验收完成。

- [逐项要求复查](requirements-audit.md)
- [队友移交清单：完成、未完成与问题](handoff-checklist.md)
- [新人启动说明](quickstart.md)
- [三分钟演示脚本](demo-script.md)
- [实际验收记录](acceptance.md)
- [购买模块适配约定](purchase-adapter.md)
- [第一步模块核对快照](module-checklist.md)

已有依赖时启动：

```powershell
.\.venv\Scripts\python.exe -X utf8 -m backend.desktop_demo
```

## 版本、位置和交付状态

代码基线：21482925fb703f8629fe537562e56db1b5e47c9d（Kaiden PR #21 已合并）。最终已快进同步至 c4841d66f3c8ea8a3a9920f4ac59ba240e97982d（prog PR #26，仅新增比赛范围说明，没有购买模块代码）。
本地分支：codex/unified-desktop-demo。
本机工作区：C:/Users/Zhengxi Chen/.codex/worktrees/unified-desktop-demo/Nexgen backend。

2026-10-22 用户已授权提交、推送本分支并创建团队 PR 供审查；main 的合并由团队审查后决定。队友可获取 codex/unified-desktop-demo 分支；仅拉取 main 在合并前不会获得本轮整合代码。随本轮提供的本地源代码 ZIP 是供人工转交的快照，不含 .git、.venv、真实 .env 或运行数据库；它不是远程已合并版本。解压后按 quickstart 新建自己的 .venv。
原项目工作区及 presentation-materials 未改动。早期未完成框架草稿在第一阶段转接记录注明的目录备份，当前实现已在更新后的 main 上重新整理，不要把旧草稿再覆盖回来。

## 文件分工

| 文件 | 本轮作用 |
|---|---|
| frontend/index.html | 唯一正式工作台；统一角色和页面导航、后端成果区、复制按钮、救援模块容器；移除前端虚拟积分 |
| frontend/integration.js / integration.css | 后端看板、缺失与失败状态、成果文案、同页路由、购买适配边界和演示时钟入口 |
| frontend/rescue-module.js / rescue-module.css | 从 Kaiden 已合并模块提取；闭包和 rescue- ID、作用域 CSS 隔离；复用原有清算交接接口 |
| backend/main.py | 明确资源白名单；/app/rescue → /app#rescue；/app/customer → /app#customer |
| backend/desktop_demo.py | 比赛专用启动器，临时数据库，应用时钟21:35起步并可推进22:31；新增 /api/demo/leftovers 登记本次盘点；强制本地文案；正常 app 不提供这些演示时钟接口 |
| backend/tests/test_desktop_demo.py | 时钟隔离、统计阶段区分、重复清算 |
| frontend/tests/integration.test.cjs | 看板缺失/失败/并发、账户隔离、适配和复制回退 |
| 现有 frontend/rescue/frontend 回归测试 | 改为验证同一正式页面、提取后的救援模块和已移除虚拟余额；Windows UTF-8/换行兼容 |
| README.md / frontend/README.md | 当前正式入口和启动说明 |
| docs/desktop-integration/ | 接口清单、启动、讲稿、适配、阶段记录与本转接文档 |

frontend/rescue.html 保留为 Kaiden 原模块参考，后端不再作为独立新页面直接提供它。业务数据文件、盲盒算法、积分政策和 ai_copy.py 没有改动。

## 数据口径与模块事件

经营看板使用 GET /api/blind-boxes/dashboard 的 simulated_revenue_sen、picked_up_qty、donated_qty、estimated_co2e_kg。
金额为整数 sen，前端只除100展示RM；完成数量单位是食品件，不是订单或盲盒数。预测金额单独显示，不与收入相加。
成功返回0显示0；字段缺失、null或格式无效显示暂无数据。刷新失败清除旧成果并禁用复制，重试成功后恢复。

角色是演示分工；老板可批准本页促销；店员与老板可操作救援；顾客只读救援。后端仍是受控本地演示，没有正式身份认证。

购买模块通过 window.Nexflow.registerPurchase 注册。getBalance(userId) 是唯一余额来源；未注册时暂无数据。状态变更后调用 changed(kind)，刷新看板与账户并清理旧盲盒建议。细节见 purchase-adapter.md。

## 验证结论和剩余工作

复查后后端272项、前端31项通过。浏览器已实走捐赠路线、角色切换、文案复制、旧入口跳转和后端停止/恢复，证据与精确数值见 acceptance.md。

仍需购买负责人提供本轮分支/模块、订单与核销入口、账户余额接口，并确认清仓录入如何进入可购买批次。比赛模式现已显式登记同一份盘点为临时合成批次，并已实走至捐赠交接；普通服务的生产库存同步仍未实现。安全/分类/过敏原为预设演示档案，不代表实际食品核验。购买模块接入时仍需确认批次和报价接口。

最终验收仍要队友在自己的电脑按说明启动，完整从盘点到购买取餐或同源余货捐赠交接走通，并填写 acceptance.md。真实模型调用与文案人工审阅、比赛电脑排练及备用录屏也没有在本轮完成。

采购预测、自动社交发布、真实 WhatsApp 发送不在本轮范围。后续继续工作时先确认远端是否有新模块交付，再接入；不要另维护第二份积分余额。
