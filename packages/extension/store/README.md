# Chrome Web Store 提交材料

本目录是上架提交所需的全部文案与配置。**每一项都对应一条官方政策**，注释里写明依据 —— 政策变化时能快速定位该改哪一条。

| 文件 | 用途 |
|---|---|
| [listing.md](listing.md) | 商店列表文案（名称、简介、详细描述、分类） |
| [justifications.md](justifications.md) | Dashboard 逐项填写内容：权限理由、远程代码申报、单用途说明 |
| [privacy-policy.md](privacy-policy.md) | 隐私政策（需托管在可公开访问的 URL） |
| [submission-checklist.md](submission-checklist.md) | 人工提交步骤清单 |

## 自动化的部分

以下已由脚本完成，不需要人工操作：

```sh
cd packages/extension
pnpm run build          # 构建扩展
node scripts/preflight.mjs   # 上架前自检（10 项，逐条对应官方政策）
node scripts/pack.mjs        # 生成可上传的 zip
```

`preflight.mjs` 会验证这些**会直接导致拒审**的点：

- manifest_version 3
- 权限未超出白名单（防 `Purple Potassium`）
- **`host_permissions` 为空**（`chrome.debugger` 不需要它）
- 打包产物无远端 `import` / `eval` / `new Function`（防 `Blue Argon`）
- CSP 锁定且不含 `unsafe-eval`
- 必需文件与图标齐全
- 描述长度在商店上限内

## 必须人工完成的部分

最后一步无法自动化 —— 需要 Google 账号、2FA 与开发者注册费。见 [submission-checklist.md](submission-checklist.md)。

**关键提醒**：Dashboard 的 **Remote Code 字段必须选「Yes」并说明理由**。官方明文：

> "Extensions that call remote code and **do not declare and justify it** using the field shown above **will be rejected**."

用 `chrome.debugger.sendCommand` 执行 agent 下发的 `Runtime.evaluate` 实质上就是执行远程代码。它虽然在允许之列（Debugger API 是官方明文例外），但**必须如实申报**。谎选「No」被发现等于直接拒审。
