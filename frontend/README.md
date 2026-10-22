# 统一电脑版工作台

正式页面：frontend/index.html，由 FastAPI `/app` 提供。原生 HTML/CSS/JavaScript，无需前端构建。

- 盘点、老板看板、活动日志、盲盒与余料、顾客购买、打烊去向使用同一页面内导航。
- Kaiden 救援模块已封装到 rescue-module.js / rescue-module.css，元素 ID 使用 rescue- 前缀，避免覆盖主页面状态与样式。
- `/app/rescue` 兼容跳转 `/app#rescue`；`/app/customer` 跳转 `/app#customer`。旧 rescue.html 仅保留作原模块参考，路由不再直接提供它。
- integration.js 读取后端 /api/blind-boxes/dashboard，缺失指标显示暂无数据；真实返回 0 则显示 0。
- 本次预测与模拟付款收入、已取餐件数、已交接捐赠件数分别展示；CO₂e 仅为估算。
- 已移除 state.consumer 的独立积分与广播加分。顾客模块及账户接口待交付，主页面暂显示暂无数据。
- WhatsApp 促销和后端成果文字可复制；自动复制失败时选中文本供手动复制。

## 启动和交接

[新人启动说明](../docs/desktop-integration/quickstart.md)、[三分钟演示](../docs/desktop-integration/demo-script.md)、[项目转接文档](../docs/desktop-integration/project-handoff.md)、[购买模块适配约定](../docs/desktop-integration/purchase-adapter.md)。

已有依赖时，在仓库根目录：

```powershell
.\.venv\Scripts\python.exe -X utf8 -m backend.desktop_demo
```

打开 <http://127.0.0.1:8000/app>。比赛入口强制 local_demo，使用临时库和固定应用时钟。成功盘点后可显式登记相同余货为合成演示批次，再从打烊去向完成交接；不需要改用另一组独立样本。常规真实时间服务仍为 `uvicorn backend.main:app`。不要双击 HTML，不要从仓库根目录公开静态文件。

## 保留的接口与行为

清仓用 GET /api/products 和 POST /api/generate-promo，数量必须为合法非负整数，零数量不提交；金额、亏损、碳估算和文案取后端结果。10 个 Butter Croissant 仍返回原价60、成本20、清仓30、毛利10、CO₂e 估算2 kg。输入 19 个会报超库存；修改后可重试。

保留本地文案、DeepSeek 成功和失败回退的来源标识；保留 422/503、网络失败、30 秒请求时限、重复提交拦截、失败清空旧结果和恢复按钮。
盲盒只读计算仍读取独立批次，不预留、不扣库存、不发积分；sen 仅转成 RM 展示。没有方案时显示后端余料建议、拒绝原因和能源估算。
Kaiden 的清算和交接继续使用现有 /api/blind-boxes/*，确认完成后刷新主看板。推荐不算完成，待交接不算已捐赠。

## 验证

```powershell
.\.venv\Scripts\python.exe -X utf8 -m pytest backend/tests -q -p no:cacheprovider
node --test frontend/tests/*.test.cjs
```

测试不调用收费模型。浏览器和跨电脑的实际验收情况见 [验收记录](../docs/desktop-integration/acceptance.md)。
