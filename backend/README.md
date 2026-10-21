# Backend & AI

成员 2 / 项目开发负责人的开发目录，目前尚未选定框架或实现服务器。

核心接口计划为 `POST /api/generate-promo`。输入示例和业务说明见[仓库首页](../README.md)。

- 从 [`../data/inventory.json`](../data/inventory.json) 读取商品信息，校验商品、数量及库存。
- 用代码计算价格和碳排放估算；碳积分规则待业务确认。
- 调用模型生成 Manglish 促销文案，将文案与计算结果返回前端。
- [`users.json`](../data/users.json) 提供演示角色；权限执行需要在后端实现。

队友原始说明中的其他接口和运行命令仅供参考，目前不可运行。
