# 扩展 CI 与商店审核

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
3. 工作流先验证和打包，再将同一份 artifact 分别提交 Chrome Web Store 和 Microsoft Edge Add-ons。两个商店任务独立运行，各自校验 SHA-256、串行处理自身的提交，某个商店失败不会阻止另一个商店执行。
4. 或在 Actions 选择 main → Run workflow → 勾选 `submit_review`，向两个商店提交当前 main 版本；不勾选只验证和产出安装包。
5. Chrome 审核通过后版本处于暂存状态，开发者在 Dashboard 完成最终上架。工作流采用 `STAGED_PUBLISH`，不跳过审核，并在校验警告时停止。

凭据缺失时提交任务会明确失败，不会静默跳过。上传超时或提交失败时先检查 Dashboard 状态再重跑，防止重复提交。工作流不等待数小时或数天的审核结果；结果在商店 Dashboard 查看。

官网 ZIP 当前仍是单独发布步骤：从 artifact 取出验证通过的 ZIP / SHA-256，放入 `docs/downloads/` 并更新 `docs/install.html` 的版本链接。普通 CI 不自动覆盖官网的正式下载包。

## Microsoft Edge Add-ons

Edge 使用 Publish API v1.1 的 API Key 认证，接口路径仍为 `/v1/products/...`。仓库中配置：

| 类型 | 名称 | 内容 |
|---|---|---|
| Variable | `EDGE_PRODUCT_ID` | Partner Center 中的产品 GUID，不是商店扩展 ID |
| Secret | `EDGE_CLIENT_ID` | Publish API 页面生成的 Client ID |
| Secret | `EDGE_API_KEY` | Publish API 页面生成的 API Key |

Release 发布或手动勾选 `submit_review` 后，`edge-review` 任务下载同一份安装包，等待上传处理成功，再创建提交并确认操作成功。日志记录版本、SHA-256 和提交状态，不输出凭据。操作超时、审核冲突和校验错误会明确失败；不会自动取消已有审核或循环重复提交。

微软 API 只负责已创建产品的更新：首次创建条目、商店资料和首次发布需在 Partner Center 完成。接入时 BUA 的首次提交正在审核，不应重复提交；待首次审核完成后，后续递增版本的 Release 可自动更新。API Key 有有效期，到期前需在 Publish API 页面生成新 Key 并更新 GitHub Secret。

微软的接口没有复用 Chrome 的 `STAGED_PUBLISH` 参数。提交成功不代表审核通过，获批后的发布时间以 Partner Center 中该产品的发布设置为准。官方参考：[Edge 发布 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)。

官方参考：[上传接口](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload)、[提交审核及暂存](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish)。
