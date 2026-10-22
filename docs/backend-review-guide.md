# 后端初版审查与改动记录

日期：2026-10-22。供 Kaden 与后端队友审查。本次 PR 提交当前本地后端初版，包括此前未上传的 AI 文案健壮性改动、盲盒两个阶段的本地演示实现，以及使用和交接说明。请先审查，不自动合并 main。

## 先运行

从仓库根目录的 PowerShell 执行；首次克隆时先创建虚拟环境：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m backend.blind_boxes.demo
```

已有 `.venv` 时不用重建。当前本地使用 Python 3.14.7。演示使用临时数据库与固定模拟时间，展示下单、领取、积分、未领和捐赠，不需要 API key，也不消耗模型额度。

启动 API：

```powershell
$env:AI_PROVIDER = 'local_demo'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Swagger：http://127.0.0.1:8000/docs 。盲盒分组为 Blind boxes LOCAL DEMO。先调用 POST /api/blind-boxes/demo-seed 导入当天合成库存；真实 API 使用服务器时间，只在 21:30 开售后接受当日未结束时段。白天演示用上面的 demo 命令。

旧前端入口 http://127.0.0.1:8000/app 仍展示原有促销，尚未接入盲盒。新接口金额为整数 sen，100 sen = RM1。完整端点、请求示例和规则见 [盲盒模块 README](../backend/blind_boxes/README.md)。

## 改动记录

| 范围 | 主要变化 | 审查入口 |
|---|---|---|
| 盲盒算法 | 安全与饮食硬筛、主食、限量、成本加成、四维评分和 Top5 抽选 | backend/blind_boxes/algorithm.py、schemas.py |
| 库存和状态 | SQLite 原子预留、幂等下单、核销、积分、限购、冻结 | backend/blind_boxes/repository.py |
| 自提和公益 | 两段取餐窗口、每分钟清算、捐赠确认、过期报废 | pickup.py、charity.py、router.py |
| API 集成 | 挂载独立路由，盲盒请求使用相应错误提示 | backend/main.py |
| 原有 AI 改动 | 整体超时、上游结构校验、空白校验、无依据声明检查、文案补原价 | backend/ai_copy.py、main.py、.env.example |
| 验证与说明 | 盲盒与 AI 回归测试、临时完整演示、联调样例和交接说明 | backend/tests/、docs/、模块 README |

保留旧促销五折逻辑和 API。盲盒库存独立于旧 JSON，不宣称共享实物库存。没有修改队友前端，没有增加依赖；不上传密钥、虚拟环境、本地数据库或空的实验测试文件。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
node --test frontend/tests/input.test.cjs
.\.venv\Scripts\python.exe -m compileall -q backend
```

本轮实现验证为后端 247 passed（其中33项盲盒案例）、前端4 passed。覆盖并发最后库存、并发幂等、事务回滚、安全停售、积分一次到账、预约边界、冻结解除、跨午夜报废和捐赠不重复计数。存在既有 Starlette TestClient/httpx 弃用提示。未进行浏览器人工端到端验收或真实付费模型验证。

## 审查时特别注意

- 当前接口是受控本地演示，公开成本和盒内明细；没有真实认证、防设备刷单、支付、退款或配送集成。不可直接作为顾客生产 API。
- 食品、安全和碳因子为合成演示资料；系统执行录入规则，不核验真实认证。捐赠确认不代表外部配送送达。
- 收入、贡献和毛利分开；碳数据是食物足迹估算，转化率缺数据返回 null。
- 旧 AI 模板对长商品名可能超过50词，关键词检查存在赠品/配送同义表达漏检，尚未修复。前端15秒超时和后端AI15秒超时也可能竞争；详见下方交接。
- 先讨论盲盒政策、共享库存迁移与前端响应格式，再决定后续整合。

完整本轮交接：[盲盒实现交接](blind-box-implementation-handoff.md)。原 AI 修改及已知缺口：[AI 后端交接](backend-handoff.md)。前端示例：[接口联调说明](frontend-integration/README.md)。部分旧文档中的“未提交、未推送”描述是当时的历史状态，以本 PR 与本页为准。
