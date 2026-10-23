# 购买模块接入约定（待负责人确认）

这是整合工作台提供的适配边界，不是购买负责人已经承诺的最终 API。负责人交付后按其实际接口实现适配器，避免另建一份余额或重复实现订单规则。

统一主页面先加载 integration.js，然后加载购买适配脚本。当前后端资源路由使用白名单；新增脚本需同时加入 backend/main.py 白名单和主页面引用。不能任意暴露整个仓库。

```javascript
await window.Nexflow.registerPurchase({
  async mount({purchaseRoot, pickupRoot, api, getContext, navigate, changed}) {
    // 把购买操作画到 purchaseRoot，把订单/取餐操作画到 pickupRoot。
    // getContext() 每次返回最新 role、userId、quantities、draft、demoTime。
    // api(path, body) 的 GET/POST 与后端同源，沿用统一错误结构和 30 秒时限。
    // 付款、核销或兑换得到后端成功确认后：await changed('pickup') 等。
    // changed 会刷新经营看板、账户余额并清理旧盲盒建议。
  },
  async getBalance(userId) {
    // 调用负责人自己的真实账户读取接口，不从广播或 CO2e 计算。
    // 返回 {user_id: userId, points: 非负整数}；未知/缺失账户应明确报错。
  },
  onContextChanged(context) {
    // 角色或顾客账户变更时同步模块；不要清掉已存在的工作台盘点。
  }
});
```

未知账户、缺失数据或接口失败时显示暂无数据。接口成功返回 points:0 时显示 0 分。较慢的旧账户响应不会覆盖新账户余额。

当前 shell 只缓存接口展示结果，不维护业务余额、不自行发分或扣分。刷新页面后以接口为准。
现有后端 /dashboard 中虽有 users 列表，但本次没有把它擅自当成购买负责人的账户接口。

仍须对齐：报价确认是否固定、付款与 RESERVED 的语义、订单持久化读取、核销入口、幂等键、清仓商品到批次的关联以及白天演示时钟。角色切换只作演示分工，不构成正式认证。
