# 扩展 CI 与 Chrome Web Store 审核

[GitHub Actions](https://github.com/joohw/bua/actions/workflows/extension.yml) 对 PR 和 main 的扩展相关改动执行：依赖构建 → 类型检查 → 扩展测试 → 构建、自检、ZIP 打包。ZIP 和 SHA-256 文件保存在运行的 `extension-package` artifact 中。

这些检查不等于商店审核，不包含目前依赖本地 Windows Chrome for Testing 的实机 E2E，也不代表审核获批。

## 首次配置

在仓库 **Settings → Secrets and variables → Actions** 中设置：

| 类型 | 名称 | 内容 |
|---|---|---|
| Variable | `CWS_EXTENSION_ID` | Chrome 商店现有扩展 ID |
| Variable | `CWS_PUBLISHER_ID` | Developer Dashboard 中的 publisher ID |
| Secret | `CWS_CLIENT_ID` | OAuth client ID |
| Secret | `CWS_CLIENT_SECRET` | OAuth client secret |
| Secret | `CWS_REFRESH_TOKEN` | 发布账号授权产生的 refresh token |

按 [Chrome Web Store API 配置说明](https://developer.chrome.com/docs/webstore/using-api) 启用 API，授权 `https://www.googleapis.com/auth/chromewebstore` scope。首次商店条目的介绍、隐私和账号要求仍须在 Developer Dashboard 完成。不要把凭据放进 Git、工作流输入或日志。

## 提交版本

1. 同时递增 `packages/extension/manifest.json` 和 `packages/extension/package.json` 的版本，合并至 main。版本必须高于商店已有版本。
2. 从已合并的提交创建并发布 GitHub Release，标签使用 `v0.1.2` 或 `extension-v0.1.2`，必须与 manifest 版本一致。每次 Release 发布都会自动触发送审流程，预发布 Release 也包含在内。仅推送标签、保存草稿或编辑已有 Release 不会重复触发送审。
3. 工作流先验证和打包，再将同一份 artifact 校验 SHA-256、上传并提交审核。提交串行执行，失败不会被当作成功。
4. 或在 Actions 选择 main → Run workflow → 勾选 `submit_review`，提交当前 main 版本；不勾选只验证和产出安装包。
5. Chrome 审核通过后版本处于暂存状态，开发者在 Dashboard 完成最终上架。工作流采用 `STAGED_PUBLISH`，不跳过审核，并在校验警告时停止。

凭据缺失时提交任务会明确失败，不会静默跳过。上传超时或提交失败时先检查 Dashboard 状态再重跑，防止重复提交。工作流不等待数小时或数天的审核结果；结果在商店 Dashboard 查看。

官网 ZIP 当前仍是单独发布步骤：从 artifact 取出验证通过的 ZIP / SHA-256，放入 `docs/downloads/` 并更新 `docs/install.html` 的版本链接。普通 CI 不自动覆盖官网的正式下载包。

Edge 暂无商店条目，当前不提交 Edge 审核。后续建立条目后，可增加独立的 Edge job 和 API 凭据，复用同一份验证产物。

官方参考：[上传接口](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload)、[提交审核及暂存](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish)。
