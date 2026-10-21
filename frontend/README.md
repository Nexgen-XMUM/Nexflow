# Frontend

成员 1 的开发目录，目前尚未初始化前端框架。

- 店员录入：选择商品、输入数量、提交后展示 Loading 状态。
- 老板 Dashboard：展示价格、碳排放估算和促销文案，提供 Approve & Broadcast 操作。
- WhatsApp 模拟对话框：展示审核后的促销消息。

共享演示数据在 [`../data/`](../data/)。`mock_data.json` 尚未提供；后续根据接口响应约定补充。核心接口计划为 `POST /api/generate-promo`，实际响应格式待后端实现时确定。
