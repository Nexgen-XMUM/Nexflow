# 任务 01：页面入口与真实字段

## 1. 所在位置

阶段 1 新版 UI 完整演示恢复：让 /app 到单品结果可用。
推进 R-1 页面与数据正确；前置为工作区和响应核对，后续为任务 02。
保留新 HTML 结构；只修改入口、映射和对应测试。

## 2. 开发所需

- 先读：backend/main.py — 页面路径和三类接口字段是什么？
- 先读：frontend/index.html — 哪些渲染字段没有来源？
- 先读：backend/tests/test_frontend.py、frontend/tests/input.test.cjs — 现有验证入口在哪里？
- 已定：用户要求保留新设计，不恢复旧文件，不扩充查询成本字段。
- 边界与测试入口：FastAPI TestClient、页面脚本与浏览器；共享 JSON/.env 不动。
- 运行：`AI_PROVIDER=local_demo DEEPSEEK_API_KEY='' .venv/bin/python -m pytest backend/tests/test_frontend.py -q`。
- 运行：`node --test frontend/tests/input.test.cjs`；脚本语法用现有 vm.Script 检查，无单独类型检查配置。
- 未知：三类接口实际形状需验证；如需要变更业务计算则停下说明。

## 3. 工作流

1. 读第 2 部分，确认本任务只恢复真实页面与数据展示。
2. 运行现有失败入口测试，补页面内容和总额断言。
3. 修正 /app 路径及测试文件路径。
4. 恢复字段映射、移除无来源字段，用现有响应渲染已知金额。
5. 运行对应测试，记录结果并保留未提交改动。

## 4. 测试案例

| 案例 | 输入 | 预期 | 入口 |
|---|---|---|---|
| 页面 | GET /app | 200，现有 index.html 与新版侧栏 | TestClient |
| 商品 | GET /api/products、/api/inventory | 现有字段，无成本公开 | TestClient |
| 单品 | 牛角包10 | 60/20/30/10 MYR、CO₂e 2 | 生成接口/页面 |
| 缺失字段 | 商品选项响应 | 无 undefined/NaN/伪造重量 | 页面渲染 |
