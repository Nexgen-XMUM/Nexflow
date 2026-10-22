# AI 文案补齐计划

范围：保留 DeepSeek 只写开头结尾、Python 计算和插入商品事实的方式。保持现有 API、来源语义和业务计算；不改前端、共享库存，不调用真实服务。初次实施未提交；2026-10-22 用户授权单独提交、推送并创建 PR 给 prog 审查。

初次实施基线：origin/dev-feng 已 rebase 到 main 的 1bd1358。2026-10-22 单独 PR 基线：main 的 c6d4ef2，分支 codex/ai-copy-follow-up。原共享工作区不作修改。

1. Python 共用商品事实拼接：商品、促销数量、原价、清仓单价；本地和 AI 文案保持 Manglish、Emoji，当前商品组合整条不超过 50 词。
2. 校验完整上游响应结构，畸形响应回退，原因只返回安全类别。
3. 开头和结尾先 strip 再校验非空。
4. 默认 15 秒整体请求时限；取消异步 HTTP 等待并关闭连接，不重试。
5. 拦截无依据的配送、优惠条件、库存承诺、认证、减排、碳积分声明；记录自然语言仍需人工审阅。

验证：模拟 HTTP 成功和异常、空白、违规声明、持续空行和取消；核对来源语义、全部商品组合和 50 词上限；用临时亏损样本比较回退前后的 items、totals、carbon、warnings；断言外发数据白名单。最后运行整个 backend/tests 和编译检查，同步配置与 README。

Ponytail/easy-* 本机不可用；经用户同意以本文档、直接实施、测试总结替代。

## 完成记录

初次实施已加入共用商品事实、嵌套响应类型检查、strip 后非空检查、可取消的整体时限、禁止声明检查。后续复查修正结论为 **3 项完成、2 项部分完成**：本地长商品名可超 50 词，禁止声明存在同义表达漏检。具体反例、未完成任务及最新验收状态见 [后端交接文档](backend-handoff.md)。业务计算和 API 响应结构保持不变。只向模型发送原有名称、数量、清仓单价白名单。

验证环境：Windows，项目 .venv，Python 3.14.7。受限环境中早前的测试没有输出；正常本机权限下已取得以下结果，未安装或升级依赖。

- 修改前：138 passed, 1 warning。
- 修改后：214 passed, 1 warning in 2.43s；命令 `.\.venv\Scripts\python.exe -m pytest backend/tests -q -p no:cacheprovider`。
- `.\.venv\Scripts\python.exe -m compileall -q backend`：退出码 0。
- `git diff --check`：退出码 0；Git 提示部分文件将按现有配置转换为 CRLF。
- 持续空行反例：模拟总时限 0.05 秒，确认停止读取、关闭请求、一次调用及 AI_TIMEOUT 回退。
- 临时混合亏损样本：清仓总额 18.00、毛利 1.00、亏损 2.00、CO₂e 1.3，各类回退后业务字段与本地基线完全一致，共享库存未改。
- 功能检查通过 FastAPI TestClient 请求实际路由完成；未进行浏览器端到端验证或真实 DeepSeek 验证。

唯一测试提示仍为既有 Starlette TestClient/httpx 弃用提示。未为此更换依赖。

来源保持：主动本地 local_demo/false，AI 成功 deepseek/false，AI 失败 local_demo/true，fallback_reason 仅安全类别。新增 INVALID_AI_CONFIG 用于非法总时限配置。

手动验证步骤及预期响应见 backend/README.md 的“Windows 验证本轮修改”。自然语言关键词校验并非完整语义保证；发布前仍需人工审阅。50 词验证覆盖当前三种商品的所有非空组合，商品目录或名称扩大后需要重新验证。

初次实施时在 origin/dev-feng，未 commit、push 或创建 PR；2026-10-22 已按用户要求单独提取到 codex/ai-copy-follow-up，创建 PR 供 prog 审查。原共享工作区和 PR #12 不修改；本 PR 不包含 backend/blind_box_test.py、docs/frontend-integration/ 或盲盒实现。

本次单独 PR 工作区复验：214 passed, 1 warning in 3.40s；编译及差异检查通过，未调用真实模型。
