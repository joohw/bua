# 调研材料索引

本目录是本项目设计决策的**依据存档**。所有政策类引文均为**逐字抓取官方文档**核对，非第三方转述。

## 报告

| 文件 | 内容 | 状态 |
|---|---|---|
| [01-competitors.md](01-competitors.md) | **同类项目调研**。浏览器 MCP 服务器、扩展路线 agent、WebMCP 标准、真实浏览器 vs 独立浏览器（含全部已知绕过方案矩阵）、安全威胁模型。195 行对比表格，事实按「✅已确认 / 🟡间接 / ⚠️推测」三级标注 | ✅ 完成 |
| [02-store-policy.md](02-store-policy.md) | **Chrome Web Store 上架硬性约束**。`debugger` 权限审核口径、远程代码政策边界、`<all_urls>` 结论、native messaging 连锁约束、隐私合规红线、替代渠道对比 | ✅ 完成 |
| [03-codex-api-reference.md](03-codex-api-reference.md) | **Codex 浏览器扩展完整 API 参考**。22 个接口 / 67 个类型 / **219 条声明**，逐条核对一致（输入 219 / 输出 219）。BUA 的 API 对齐基准 | ✅ 完成 |

## 三份报告各自改变了什么

| 报告 | 对设计的实际影响 |
|---|---|
| 01-competitors | **推翻了「origin 白名单即安全边界」的假设**（三方独立承认 URL 白名单不可靠）；确立「动作级闸门」为核心差异化；补出传输层 Origin/Host 双校验要求；发现 open-browser-use 仅 365★ 的时间窗口 |
| 02-store-policy | **确认技术路线可上架**（Debugger API 是官方明文允许的远程执行例外）；删掉冗余的 `<all_urls>`；确定放弃 native messaging 改走 WebSocket；暴露「调试横幅不可关闭，用户关掉即终止会话」这一硬 UX 约束 |
| 03-codex-api-reference | 提供 API 对齐的**唯一权威依据**（逐条声明原文，可逐字核对） |

## `_raw/` — 官方文档存档

`_raw/` 保存了调研过程中抓取的**官方文档原文**（约 12 MB），用于引文复核。主要是：

- **Chrome Web Store 政策**：`pol-*.txt`（各条政策单页）、`cws-*.txt`（Dashboard / 发布 / 隐私 / 疑难排查）
- **Chrome 扩展开发文档**：`debugger-api.*`、`manifest-v3.md.txt`、`optional-perms.md.txt`、`declare-permissions.md.txt`、`native-msg-windows.md.txt`、`side-panel.md.txt`、`service-worker-lifecycle.md.txt`
- **第三方旁证**：`tp-*.txt`（已标注可信度，仅作旁证）
- **导出脚本**：`generate.py` / `verify.py` / `analyze*.py`（可复跑复现 API 参考文档）

## 使用注意

1. **引文可信度分级**：报告内用 `[官方·原文]` / `[官方·索引]` / `[第三方]` / `[推断]` 四级标记。凡引用结论请连带标记一起看。
2. **`_raw/` 中的大文件**（如 `ext-settings-pol.txt` 1.5 MB）含大量导航噪声，是整页抓取的产物，检索时建议用关键词定位而非通读。
3. 本目录**不是**产品文档。若要了解 BUA 本身，看 [../docs/design.md](../docs/design.md) 与 [../README.md](../README.md)。
