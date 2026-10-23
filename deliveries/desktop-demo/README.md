# 电脑版源码 ZIP 交付

[下载源码交付包](nexflow-desktop-handoff-20261023.zip)（打开后选择 Download raw file）。

此包对应 [PR #27](https://github.com/Nexgen-XMUM/Nexflow/pull/27) 的源码提交 `8fdcac4384e1f295c9996096e9ea986ca8ad12d1`，不自动同步后续 main。源码文件与该提交逐项一致；另附交付说明和逐文件 SHA256 清单。

1. 下载并解压到新文件夹，避免覆盖已有项目。
2. 按包内 `docs/desktop-integration/quickstart.md` 安装依赖并启动。
3. 查看 `project-handoff.md`、`demo-script.md`、`acceptance.md` 了解移交、演示及验证范围。

包内文档是提交时快照，部分交付状态措辞早于 PR 合并；当前远程状态以 GitHub 为准。购买模块、积分账户接口和队友电脑启动验收仍待完成。

ZIP 不含虚拟环境、真实配置密钥、Git 元数据和运行数据库。配置模板 `backend/.env.example` 已保留。整包校验值见 [SHA256SUMS.txt](SHA256SUMS.txt)，包内 `SOURCE-MANIFEST.json` 提供逐源码文件校验值。

这是为便于队友下载而提供的固定快照；日常协作请拉取 main，以获得团队后续改动。
