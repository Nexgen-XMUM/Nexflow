# Nexflow
Automate the Routine. Empower the People.

面向马来西亚烘焙店的黑客松项目：录入剩余商品，由后端计算清仓价格和碳排放估算，AI 生成 Manglish 促销文案，老板审核后展示模拟 WhatsApp 广播。

## 当前状态

本仓库目前只有目录骨架和队友提供的演示数据，尚未实现前端、服务器或 API。根目录现有的依赖清单及锁文件仍为空占位文件，不代表已选定技术栈，暂不能用于安装或启动项目。正式开发时，应在对应前后端目录初始化依赖，并只保留选定包管理器的锁文件。

## 目录与分工

```text
frontend/                 前端页面与交互（成员 1）
backend/                  后端、业务计算与 AI 接口（成员 2 / 项目开发负责人）
data/
  inventory.json          商品、价格、重量、碳排放系数与库存
  users.json              演示角色与权限
  customers.json          演示 WhatsApp 联系人
docs/
  reference-demo/README.md 队友提供的原始说明，仅供参考
```

- 成员 1：店员录入表单、老板 Dashboard、模拟 WhatsApp 对话框；先使用假数据，再接入真实 API。
- 成员 2（项目开发负责人）：服务器、输入校验、价格与碳排放计算、AI 文案生成、接口联调。
- 成员 3：维护共享 JSON、API 边界测试及项目文档。
- 成员 4：提供业务公式和 UI 素材；碳排放系数依据、碳积分换算规则待确认。

## 后端接口方向（待实现）

核心接口为 `POST /api/generate-promo`，按当前分工接收：

```json
[{"item":"croissant","qty":10}]
```

后端从 `data/inventory.json` 的 `products` 数组读取商品（分工中的 `products.json` 对应这份文件，无需维护两份）。价格和碳排放由代码计算，AI 只生成文案；响应字段将在实现接口时确定。

以现有数据和分工中的五折示例计算，10 个牛角包原价 RM60、成本 RM20、清仓价 RM30。数据中的 `weight_kg` 是商品重量，不是面粉重量；按 `qty × weight_kg × co2e_per_kg` 得到的示例估算为 2 kg CO₂e。该数值不是已验证的减排量，也不是碳积分，业务规则确认后再用于正式展示。

## 数据与参考说明

三份 JSON 和 [队友原始 README](docs/reference-demo/README.md) 均按原文件导入。原始说明中的项目名、`server.py`、`/api/draft`、`/api/approve` 和运行方式描述的是队友的 demo，不表示本仓库已有对应实现。

原始说明将联系人标注为虚构演示数据，仅用于模拟展示。`users.json` 只描述角色权限，不提供登录认证或实际权限校验。前端不要把包含成本价或联系人信息的完整数据直接作为公开静态资源发布。

真实密钥使用本地环境变量；`.env`、虚拟环境、依赖目录、构建缓存、数据库及运行生成的 `data/activity.json` 不提交。需要本地修改的实验数据可放入已忽略的 `data/local/`，保留共享演示数据可复用。
