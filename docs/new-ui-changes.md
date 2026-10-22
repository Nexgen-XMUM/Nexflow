# Feature New UI：最终改动清单

基线：已获取的origin/main 026567ddb6f0ed9e882387bb1f4e46c5bc5cc927。本地codex/feature-new-ui已移到该已有提交，本轮修改均未提交。

相对该基线：**9个已跟踪文件修改、8个新增未跟踪文件，共17个文件**。原23文件清单是相对Pan旧基线的历史范围，已由本清单替代；基础盲盒和计算器不重复算作新增。

| 文件 | 状态 | 改动 |
|---|---|---|
| `backend/blind_boxes/README.md` | 修改 | 保留主线calculate说明，补充新UI报价合同和最新状态。 |
| `backend/blind_boxes/repository.py` | 修改 | 保留Repository.calculate；增加报价持久化、确认、顾客白名单/账户和共用预留逻辑。 |
| `backend/blind_boxes/router.py` | 修改 | 保留/calculate及原端点，增加/quotes、/quotes/confirm、/customer/account。 |
| `backend/blind_boxes/schemas.py` | 修改 | 保留CalculateRequest，增加QuoteConfirmRequest。 |
| `backend/main.py` | 修改 | 主线已有盲盒挂载基础上新增新页面与两个指定JS/CSS资源入口。 |
| `backend/tests/test_blind_box_quotes.py` | 新增 | 报价隐藏、固定价格、幂等、过期/安全/资料变化和并发库存。 |
| `backend/tests/test_frontend.py` | 修改 | 按UTF-8原始字节比较页面，兼容Windows编码及CRLF。 |
| `backend/tests/test_new_ui.py` | 新增 | 新旧页面/指定资源入口和顾客白名单。 |
| `docs/new-ui-changes.md` | 新增 | 本清单，相对已整合主线的实际范围。 |
| `docs/new-ui-integration.md` | 新增 | 最终交接、启动、验证、主线整合和产品边界。 |
| `docs/new-ui-pr-draft.md` | 新增 | 可审阅PR文案，尚未发布。 |
| `frontend/README.md` | 修改 | 新UI入口、操作及最终交接。 |
| `frontend/blind-boxes.css` | 新增 | 独立盲盒样式、深色对比、统计卡片及响应式布局。 |
| `frontend/blind-boxes.js` | 新增 | 老板/顾客报价、订单、捐赠、统计、积分抵扣及原请求重试。 |
| `frontend/tests/blind-boxes.test.cjs` | 新增 | 24项盲盒前端测试，加原10项共34项。 |
| `frontend/tests/flow.test.cjs` | 修改 | 支持NEXFLOW_TEST_PYTHON复用现有环境。 |
| `orbyte smart yield.html` | 修改 | 仅增加独立JS/CSS引用及注释，共3行。 |

## 完整保留、无差异的主线内容

calculator.py、原计算器测试、data/charities.json、原algorithm/charity/pickup/demo模块和原盲盒测试保留。CalculateRequest、Repository.calculate及/calculate与本地报价功能并存，没有删除队友计算器。

## 不提交的内容

原共享工作区backend/blind_box_test.py、docs/blind-box-algorithm-review.md未动。真实.env、密钥、数据库、虚拟环境、忽略的备份、本机固定时钟脚本和截图不进入PR。依赖未新增或升级；旧frontend/index.html、DeepSeek和原共享JSON未改。

## 验证和审查

整合后后端265项、前端34项通过，1条既有弃用提示；同应用临时数据库HTTP联调通过。重点审查报价固定及安全库存复核、顾客白名单和演示权限边界、积分/捐赠/统计语义及Pan原页面最小改动。发布前仍需核对届时最新main及用户授权。
